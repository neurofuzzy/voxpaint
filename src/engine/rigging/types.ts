import type { Axis, Coord, GridExtent } from '@/engine/grid/types'
import type { JointEuler } from './pose'
import { effectiveExtent } from '@/engine/grid/GridStore'
import type { ConstructionPlane } from '@/engine/plane/types'
import { toDisplayGridlineU, toDisplayGridlineV } from '@/engine/plane/planeDisplay'
import { axisIndex } from '@/engine/plane/planeGeometry'

/**
 * A named rigging selection: an axis-aligned bounding box in grid coordinates (inclusive
 * min/max corners). Boxes are decoupled from the model — they name whatever voxels happen to
 * lie inside at GLTF export time, and survive model edits untouched.
 *
 * Hierarchy: `parentId` links a box into the rig outline (null = root). Export emits nested
 * `Group` nodes, so the outline reads as a joint tree downstream. Overlap resolution is
 * deepest-first (a nested box wins over its ancestors), ties broken by list order.
 *
 * Posing: `pivot` is the box's rotation center as an absolute grid point in world frame
 * (roots and children alike — nesting never relativizes it; future posing transforms will).
 * Like slice pivots, the world center is the grid point +0.5 per axis, so integer pivots sit
 * on cell centers and half-integer pivots sit exactly on cell boundaries (joint faces).
 * Null = box center.
 */
export type RigBox = {
  id: string
  name: string
  min: Coord
  max: Coord
  /** Parent box id, or null for a root box. */
  parentId: string | null
  /** Rotation-center grid point override, or null for the box center. */
  pivot: Coord | null
  /** Ordered tween stack — absent/empty for a static (pose-only) joint. Stack order is
   * composition order (top-first); see `engine/rigging/rigLoop.ts`. */
  tweens?: RigTween[]
}

/**
 * One looping procedural motion ("tween") on a rig box (Animate mode): a turntable spin
 * or an axial shuttle, cycling forever. `axis` is the world axis the motion runs on,
 * `direction` flips its sense (CW vs CCW, ± slide), `speed` is the 1x/2x/3x cycle-rate
 * multiplier shared with slice loops, and `amount` is the slide amplitude in voxels
 * (unused by rotate). A box holds an ordered stack — all enabled tweens evaluate at time
 * t and compose top-first (stack order is load-bearing: rotations don't commute).
 * `enabled: false` keeps the tween's params while muting it.
 */
export type RigTweenKind = 'rotate' | 'slide'
export type RigTween = {
  id: string
  kind: RigTweenKind
  axis: Axis
  direction: 1 | -1
  speed: import('@/engine/animation/types').AnimationSpeed
  /** Slide amplitude in voxels (unused by rotate). */
  amount: number
  enabled: boolean
}

/**
 * A named joint snapshot: per-box local rotations (radians, intrinsic XYZ, same
 * representation as the live gizmo scratch). Sparse — only non-bind joints are stored.
 * Poses are data: undoable, persisted, and (phase 2) interpolated by pose cycles.
 */
export type Pose = {
  id: string
  name: string
  joints: Record<string, JointEuler>
}

/**
 * A pose-to-pose playback loop (timeline-less): interpolates every joint from one pose
 * to another, then — per mode — holds (`once`), jumps back (`loop`), or eases back
 * (`pingpong`, seamless). `speed` reuses the 1x/2x/3x cycle-rate scale. Poses are looked
 * up by id at eval time; a dangling side reads as bind.
 */
export type PoseCycleMode = 'once' | 'loop' | 'pingpong'
export type PoseCycle = {
  fromId: string
  toId: string
  mode: PoseCycleMode
  speed: import('@/engine/animation/types').AnimationSpeed
}

export function newPoseId(): string {
  try {
    return `pose-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `pose-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`
  }
}

/** Sanitizes a deserialized pose (hand-edited files): unknown shapes fall back to null. */
export function sanitizePose(raw: unknown, validBoxIds?: Set<string>): Pose | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<Pose>
  if (typeof p.id !== 'string' || p.id.length === 0) return null
  if (typeof p.name !== 'string') return null
  if (!p.joints || typeof p.joints !== 'object') return null
  const joints: Pose['joints'] = {}
  for (const [boxId, euler] of Object.entries(p.joints)) {
    if (validBoxIds && !validBoxIds.has(boxId)) continue
    if (!Array.isArray(euler) || euler.length !== 3 || !euler.every((n) => Number.isFinite(n))) continue
    joints[boxId] = [euler[0], euler[1], euler[2]]
  }
  return { id: p.id.slice(0, 64), name: p.name.slice(0, 64) || 'pose', joints }
}

export function newTweenId(): string {
  try {
    return `tw-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `tw-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`
  }
}

/** Sanitizes a deserialized tween (hand-edited files): unknown shapes fall back to null. */
export function sanitizeRigTween(raw: unknown): RigTween | null {
  if (!raw || typeof raw !== 'object') return null
  const l = raw as Partial<RigTween>
  if (l.kind !== 'rotate' && l.kind !== 'slide') return null
  if (l.axis !== 'x' && l.axis !== 'y' && l.axis !== 'z') return null
  if (l.direction !== 1 && l.direction !== -1) return null
  if (l.speed !== 1 && l.speed !== 2 && l.speed !== 3) return null
  if (typeof l.amount !== 'number' || !Number.isFinite(l.amount)) return null
  const amount = Math.max(1, Math.min(8, l.amount))
  const id = typeof l.id === 'string' && l.id.length > 0 ? l.id.slice(0, 64) : newTweenId()
  return { id, kind: l.kind, axis: l.axis, direction: l.direction, speed: l.speed, amount, enabled: l.enabled !== false }
}

/** GLTF-safe mesh name: letters, digits, `_`, `-` ( Blender/Unity-friendly). */
export function sanitizeRigName(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 64)
  return cleaned.length > 0 ? cleaned : fallback
}

/** Inclusive bbox containment test. */
export function rigBoxContains(box: RigBox, coord: Coord): boolean {
  return (
    coord[0] >= box.min[0] && coord[0] <= box.max[0] &&
    coord[1] >= box.min[1] && coord[1] <= box.max[1] &&
    coord[2] >= box.min[2] && coord[2] <= box.max[2]
  )
}

/**
 * A box's rotation center in grid coordinates: its pivot override, or the bbox center.
 * Add 0.5 per axis for the world center (same convention as slice pivots — a pivot cell's
 * world center is the cell coordinate +0.5).
 */
export function rigPivotOf(box: RigBox): Coord {
  if (box.pivot) return [...box.pivot] as Coord
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ]
}

/**
 * Depth of a box in the outline tree (roots are 0, their children 1, …). Cycle-safe: a
 * broken parent chain just stops counting. Used for deepest-wins assignment and for ordering
 * overlapping footprints (deeper boxes draw/hit-test on top).
 */
export function rigDepthOf(boxes: RigBox[], box: RigBox): number {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  let depth = 0
  let current = box
  const seen = new Set<string>([current.id])
  while (current.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    depth++
    current = parent
  }
  return depth
}

/**
 * Rig assignment for an explicit voxel coordinate: the deepest box containing it (a nested
 * box wins over its ancestors), ties broken by list order. Returns the box id or null when
 * no box contains the voxel (caller exports those as the default mesh).
 */
export function rigIdForCoord(boxes: RigBox[], coord: Coord): string | null {
  let best: RigBox | null = null
  let bestDepth = -1
  for (const box of boxes) {
    if (!rigBoxContains(box, coord)) continue
    const depth = rigDepthOf(boxes, box)
    if (depth > bestDepth) {
      best = box
      bestDepth = depth
    }
  }
  return best?.id ?? null
}

/** Drop position for outline reordering: beside the target row, or nested as its last child. */
export type RigMovePosition = 'before' | 'after' | 'child'

/** All ids in the subtree rooted at `id` (inclusive), following `parentId` links. */
export function rigSubtreeIds(boxes: RigBox[], id: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const b of boxes) {
    if (b.parentId) {
      const list = children.get(b.parentId)
      if (list) list.push(b.id)
      else children.set(b.parentId, [b.id])
    }
  }
  const out = new Set<string>([id])
  const stack = [id]
  while (stack.length > 0) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!out.has(child)) {
        out.add(child)
        stack.push(child)
      }
    }
  }
  return out
}

/**
 * Pure outline move: relocates `dragId` to `targetId` (`null` = end of the root level).
 * `before`/`after` adopt the target's parent and land beside its whole subtree; `child`
 * parents under the target as its last child. Returns the new array (pre-order: a parent
 * immediately precedes its subtree), or null when the move is invalid (unknown ids, or the
 * target sits inside the dragged subtree) — callers treat null as a no-op.
 */
export function moveRigBoxInList(
  boxes: RigBox[],
  dragId: string,
  targetId: string | null,
  position: RigMovePosition,
): RigBox[] | null {
  const drag = boxes.find((b) => b.id === dragId)
  if (!drag) return null
  if (targetId === dragId) return null
  if (targetId === null) {
    const rest = boxes.filter((b) => b.id !== dragId)
    return [...rest, { ...drag, parentId: null }]
  }
  const target = boxes.find((b) => b.id === targetId)
  if (!target) return null
  // No-op when the target sits inside the dragged subtree (would parent a box to itself).
  if (rigSubtreeIds(boxes, dragId).has(target.id)) return null

  const rest = boxes.filter((b) => b.id !== dragId)
  const moved: RigBox = { ...drag, parentId: position === 'child' ? target.id : target.parentId }

  // Anchor at the target's subtree end so the moved box never splits another subtree:
  // `before` lands at the target's start, `after`/`child` after its last descendant.
  const subtree = rigSubtreeIds(rest, target.id)
  let anchor = rest.findIndex((b) => b.id === target.id)
  if (position !== 'before') {
    for (let i = rest.length - 1; i >= 0; i--) {
      if (subtree.has(rest[i].id)) { anchor = i + 1; break }
    }
  }
  return [...rest.slice(0, anchor), moved, ...rest.slice(anchor)]
}

/**
 * A box's footprint on a construction-plane slice, in display-space cell units (the same
 * space the 2D canvas draws in — post orientation mirror). Null when the slice doesn't
 * intersect the box. `uMax`/`vMax` are exclusive bounds, so the rect covers
 * [uMin, uMax) × [vMin, vMax): corners come from the gridline transforms, which place a
 * mirrored range exactly (a mirror maps [a, b] to [-b, -a], where the cell version's `-1`
 * correction would shift it a cell).
 */
export function boxSliceFootprint(
  box: RigBox,
  plane: ConstructionPlane,
): { uMin: number; uMax: number; vMin: number; vMax: number } | null {
  if (plane.offset < box.min[axisIndex(plane.axis)] || plane.offset > box.max[axisIndex(plane.axis)]) {
    return null
  }
  // In-plane grid ranges, then their logical (u,v) endpoints: pixelFromGridCoord negates some
  // axes (v everywhere, u on the x-plane), and the negation applies to gridline positions too —
  // feeding raw grid coords into the gridline transforms below would shift mirrored ranges by
  // a cell. Endpoints are gridlines (a and b+1 for inclusive cells [a,b]); the gridline
  // transforms then place the zero-width positions exactly, mirror included.
  let lu0: number
  let lu1: number
  let lv0: number
  let lv1: number
  switch (plane.axis) {
    case 'x':
      lu0 = -box.min[2]; lu1 = -(box.max[2] + 1); lv0 = -box.min[1]; lv1 = -(box.max[1] + 1)
      break
    case 'y':
      lu0 = box.min[0]; lu1 = box.max[0] + 1; lv0 = -box.min[2]; lv1 = -(box.max[2] + 1)
      break
    case 'z':
      lu0 = box.min[0]; lu1 = box.max[0] + 1; lv0 = -box.min[1]; lv1 = -(box.max[1] + 1)
      break
  }
  const du0 = toDisplayGridlineU(plane, lu0)
  const du1 = toDisplayGridlineU(plane, lu1)
  const dv0 = toDisplayGridlineV(plane, lv0)
  const dv1 = toDisplayGridlineV(plane, lv1)
  // Endpoint negation above can produce -0 (e.g. -box.min for a 0 bound) — normalize so
  // strict equality (and serialized output) never distinguishes it from 0.
  const norm = (n: number) => (n === 0 ? 0 : n)
  return {
    uMin: norm(Math.min(du0, du1)),
    uMax: norm(Math.max(du0, du1)),
    vMin: norm(Math.min(dv0, dv1)),
    vMax: norm(Math.max(dv0, dv1)),
  }
}

/**
 * Rounds onto the 2x placement lattice (cell centers and boundary intersections alike),
 * normalizing -0 so strict equality never distinguishes it from 0.
 */
export function snapHalf(n: number): number {
  const s = Math.round(n * 2) / 2
  return s === 0 ? 0 : s
}

/**
 * Single-click pivot placement for the Pivot tool: the click's continuous display position
 * snaps to the half-step lattice, then converts back through the exact inverse of the render
 * path (`displayPointForGridPoint` — gridline unmirror, then axis unshuffle, then world→grid
 * by dropping the +0.5 world offset), so the pivot lands precisely under the cursor on cell
 * centers and boundary intersections alike. Only the plane's own two axes move; the depth
 * axis keeps the current pivot (box center when unset) — rotate the construction plane to
 * place depth, the same framing every modeling tool uses. Pure.
 */
export function placePivotOnPlane(box: RigBox, plane: ConstructionPlane, cu: number, cv: number): Coord {
  const lu = toDisplayGridlineU(plane, snapHalf(cu))
  const lv = toDisplayGridlineV(plane, snapHalf(cv))
  const depth = rigPivotOf(box)[axisIndex(plane.axis)]
  switch (plane.axis) {
    case 'x':
      return [depth, -lv - 0.5, -lu - 0.5]
    case 'y':
      return [lu - 0.5, depth, -lv - 0.5]
    case 'z':
      return [lu - 0.5, -lv - 0.5, depth]
  }
}

/**
 * Parent→child pivot links for the rig outline: one entry per box whose parent resolves to a
 * different surviving box (dangling and self parents are skipped — same guards as the outline
 * list). Grid coordinates; the view adds +0.5 per axis for world space, mirroring rigPivotOf.
 */
export type RigPivotLink = { childId: string; parentId: string; from: Coord; to: Coord }

export function rigPivotLinks(boxes: RigBox[]): RigPivotLink[] {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const links: RigPivotLink[] = []
  for (const box of boxes) {
    if (!box.parentId || box.parentId === box.id) continue
    const parent = byId.get(box.parentId)
    if (!parent) continue
    links.push({ childId: box.id, parentId: parent.id, from: rigPivotOf(parent), to: rigPivotOf(box) })
  }
  return links
}

/**
 * Translates a box and its whole subtree by `delta` grid cells, clamped so every moved box
 * stays inside the working cube (the request shrinks to the largest shift that fits all of
 * them — relatives never distort). Pivots ride along, clamped into the cube independently
 * (they may sit outside their box). Returns the new array, or null for unknown ids and
 * zero-effective shifts — callers treat null as a no-op and skip their undo bracket.
 */
export function translateRigSubtree(
  boxes: RigBox[],
  id: string,
  delta: Coord,
  gridExtent: GridExtent,
): RigBox[] | null {
  if (!boxes.some((b) => b.id === id)) return null
  const moving = rigSubtreeIds(boxes, id)
  const half = effectiveExtent(gridExtent) / 2
  const lo = -half
  const hi = half - 1
  // Per axis, the shift must satisfy lo <= min + d and max + d <= hi for every moved box.
  const applied: [number, number, number] = [0, 1, 2].map((a) => {
    let allowLo = -Infinity
    let allowHi = Infinity
    for (const b of boxes) {
      if (!moving.has(b.id)) continue
      allowLo = Math.max(allowLo, lo - b.min[a])
      allowHi = Math.min(allowHi, hi - b.max[a])
    }
    return Math.max(allowLo, Math.min(allowHi, delta[a]))
  }) as [number, number, number]
  if (applied[0] === 0 && applied[1] === 0 && applied[2] === 0) return null
  // Pivots are grid points, not cells: they may sit on the cube's outer gridlines (half),
  // one half-step beyond the last cell center.
  const pclamp = (v: number) => Math.max(lo, Math.min(half, v))
  return boxes.map((b) => {
    if (!moving.has(b.id)) return b
    return {
      ...b,
      min: [b.min[0] + applied[0], b.min[1] + applied[1], b.min[2] + applied[2]] as Coord,
      max: [b.max[0] + applied[0], b.max[1] + applied[1], b.max[2] + applied[2]] as Coord,
            pivot: b.pivot
        ? ([pclamp(b.pivot[0] + applied[0]), pclamp(b.pivot[1] + applied[1]), pclamp(b.pivot[2] + applied[2])] as Coord)
        : null,
    }
  })
}
