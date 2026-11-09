import type { Axis, Coord } from '@/engine/grid/types'
import type { JointEuler } from './pose'
import type { KeyJoints, KeyOffsets, RigBox } from './types'

/** The joint data a keyframe owns (rotations plus optional offsets). */
export type MirrorableJoints = {
  joints: KeyJoints
  offsets?: KeyOffsets
}

/**
 * Left/right token pairs for joint-name mirroring, matched case-sensitively as whole
 * name segments (never substrings): `left`↔`right`, `l`↔`r`, `L`↔`R`, `Left`↔`Right`,
 * `LEFT`↔`RIGHT`. Anything else (including `shoulder`, `elbow`, `lr`) maps to itself.
 */
const SIDE_SWAPS: Readonly<Record<string, string>> = {
  left: 'right',
  right: 'left',
  l: 'r',
  r: 'l',
  L: 'R',
  R: 'L',
  Left: 'Right',
  Right: 'Left',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT',
}

/**
 * Swaps the left/right token of a joint name when it is a whole PREFIX or SUFFIX
 * segment, separated from the rest by `-`, `_`, `.` or a space — keeping the case
 * pairing above (`arm-upper-left`→`arm-upper-right`, `leg_l`→`leg_r`, `Hand.L`→`Hand.R`,
 * `left-foot`→`right-foot`, `Left Arm`→`Right Arm`). A name that is exactly a side
 * token (`left`, `R`, …) swaps as well. Both ends swap independently when both match.
 * Anything else — unpaired names, mid-name tokens, substrings inside words
 * (`shoulder`, `elbow`, `lr`, `armL`) — maps to itself. Pure.
 */
export function mirrorJointName(name: string): string {
  const direct = SIDE_SWAPS[name]
  if (direct !== undefined) return direct
  // Split keeping the separators so prefix/suffix swaps survive length changes
  // (`left`↔`right` differ in length) and the original separators are preserved.
  const parts = name.split(/([-_. ])/)
  if (parts.length === 1) return name
  const headSwap = SIDE_SWAPS[parts[0]]
  if (headSwap !== undefined) parts[0] = headSwap
  const last = parts.length - 1
  const tailSwap = SIDE_SWAPS[parts[last]]
  if (tailSwap !== undefined) parts[last] = tailSwap
  return parts.join('')
}

/** Normalizes -0 to 0 so mirrored bind components stay deep-equal to literal 0. */
function norm(n: number): number {
  return n === 0 ? 0 : n
}

/**
 * Mirrors one intrinsic-XYZ euler under the axis reflection M (the rotation part of
 * R′ = M·R·M for a mirror plane perpendicular to `axis`): `x` → (rx,−ry,−rz),
 * `y` → (−rx,ry,−rz), `z` → (−rx,−ry,rz). Pure.
 */
function mirrorEuler(e: JointEuler, axis: Axis): JointEuler {
  switch (axis) {
    case 'x':
      return [norm(e[0]), norm(-e[1]), norm(-e[2])]
    case 'y':
      return [norm(-e[0]), norm(e[1]), norm(-e[2])]
    default:
      return [norm(-e[0]), norm(-e[1]), norm(e[2])]
  }
}

/**
 * Mirrors one offset under the axis reflection: the axis component negates
 * (`x` → −x for the default axis), the others pass through. Pure.
 */
function mirrorOffset(o: Coord, axis: Axis): Coord {
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const out: Coord = [norm(o[0]), norm(o[1]), norm(o[2])]
  out[i] = norm(-o[i])
  return out
}

/**
 * Mirrors a keyframe's joint data across the plane perpendicular to `axis` (default
 * `x`: the character faces +Z, so left/right runs along X). Returns NEW joint data —
 * the caller sets the key's id/name.
 *
 * Pairing runs on box NAMES via `mirrorJointName`: a box is paired only when its
 * mirrored name resolves to exactly one DIFFERENT box whose own mirrored name
 * resolves back (mutual — ambiguous duplicates on either side unpair both ends, so
 * mirroring twice stays an involution). Paired joints SWAP values with the mirror
 * applied; unpaired joints mirror in place. Joints are SPARSE (absent = bind), so each
 * pair iterates the union of both sides: a side absent in the source stays absent in
 * the output unless the mirrored opposite is non-bind (only the keyed left joint →
 * only the mirrored right joint out). Sides present in the source (even explicit
 * bind) are always written, so mirroring twice restores the original exactly.
 *
  * Offsets follow the same pairing with the axis component negated; `offsets` stays
 * absent when the source had none. Every component passes
 * through `norm`, so no -0 noise breaks a deep-equal double-mirror. Pure.
 */
export function mirrorJoints(source: MirrorableJoints, boxes: RigBox[], axis: Axis = 'x'): MirrorableJoints {
  const byName = new Map<string, RigBox[]>()
  for (const b of boxes) {
    const list = byName.get(b.name)
    if (list) list.push(b)
    else byName.set(b.name, [b])
  }
  // Directed pairing first (mirrored name hits exactly one different box), then keep
  // only mutual pairs so duplicates unpair both ends instead of fighting over one slot.
  const directed = new Map<string, string>()
  for (const b of boxes) {
    const mirrored = mirrorJointName(b.name)
    if (mirrored === b.name) continue
    const candidates = byName.get(mirrored) ?? []
    if (candidates.length === 1 && candidates[0].id !== b.id) directed.set(b.id, candidates[0].id)
  }
  const partner = new Map<string, string>()
  for (const [id, other] of directed) {
    if (directed.get(other) === id) partner.set(id, other)
  }

  const boxIds = new Set(boxes.map((b) => b.id))
  const joints: KeyJoints = {}
  const visited = new Set<string>()
  for (const b of boxes) {
    if (visited.has(b.id)) continue
    const otherId = partner.get(b.id)
    if (otherId !== undefined && !visited.has(otherId)) {
      visited.add(b.id)
      visited.add(otherId)
      const a = source.joints[b.id]
      const c = source.joints[otherId]
      // Each side writes only from its own source value (the partner's, swapped):
      // a side absent in the source stays absent (mirror of bind is bind), so a lone
      // keyed left joint yields only the mirrored right joint. Present sides always
      // write, even explicit bind, so mirroring twice restores the original exactly.
      if (a !== undefined) joints[otherId] = mirrorEuler(a, axis)
      if (c !== undefined) joints[b.id] = mirrorEuler(c, axis)
    } else {
      visited.add(b.id)
      const v = source.joints[b.id]
      if (v !== undefined) joints[b.id] = mirrorEuler(v, axis)
    }
  }
  // Joints keyed by unknown box ids (stale references) have no pair: mirror in place
  // rather than dropping data.
  for (const [id, v] of Object.entries(source.joints)) {
    if (!boxIds.has(id) && joints[id] === undefined) joints[id] = mirrorEuler(v, axis)
  }

  let offsets: KeyOffsets | undefined
  if (source.offsets) {
    offsets = {}
    const visitedOff = new Set<string>()
    for (const b of boxes) {
      if (visitedOff.has(b.id)) continue
      const otherId = partner.get(b.id)
      if (otherId !== undefined && !visitedOff.has(otherId)) {
        visitedOff.add(b.id)
        visitedOff.add(otherId)
        const a = source.offsets[b.id]
        const c = source.offsets[otherId]
        if (a !== undefined) offsets[otherId] = mirrorOffset(a, axis)
        if (c !== undefined) offsets[b.id] = mirrorOffset(c, axis)
      } else {
        visitedOff.add(b.id)
        const v = source.offsets[b.id]
        if (v !== undefined) offsets[b.id] = mirrorOffset(v, axis)
      }
    }
    for (const [id, v] of Object.entries(source.offsets)) {
      if (!boxIds.has(id) && offsets[id] === undefined) offsets[id] = mirrorOffset(v, axis)
    }
  }

  const out: MirrorableJoints = { joints }
  if (offsets) out.offsets = offsets
  return out
}
