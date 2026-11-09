import * as THREE from 'three'
import type { Coord } from '@/engine/grid/types'
import { BASE_CYCLE_SECONDS } from '@/engine/animation/animationLayers'
import { eulerToQuaternion, type JointEuler } from './pose'
import { hasActiveTweens } from './rigLoop'
import {
  CLIP_FRAME_SECONDS,
  newClipId,
  newKeyId,
  snapClipTime,
  type KeyJoints,
  type KeyOffsets,
  type RigBox,
  type RigClip,
  type AnimationMode,
  type ClipKey,
  type KeyEase,
} from './types'

/**
 * One evaluated clip instant: per-joint local rotations (radians, intrinsic XYZ, sparse —
 * only joints keyed anywhere in the clip appear) plus per-root translation offsets in
 * voxels (sparse likewise). Absent entries ARE bind.
 */
export type PoseFrame = {
  rot: Map<string, JointEuler>
  off: Map<string, Coord>
}

/**
 * Eases a unit phase `u` through a key's preset: `linear` passes through, `inOut` is the
 * cosine ease the pose cycle always used, `in`/`out` are quarter-sine halves of it, and
 * `hold` returns 0 for every `u` (a step — the outgoing pose freezes until the next key).
 * `u` clamps to [0, 1].
 */
export function easePhase(ease: KeyEase, u: number): number {
  const c = Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0
  // Exact endpoints (trig dust like cos(π/2) ≈ 6e-17 must never leak into key instants).
  if (c <= 0) return 0
  if (c >= 1) return ease === 'hold' ? 0 : 1
  switch (ease) {
    case 'linear':
      return c
    case 'in':
      return 1 - Math.cos((c * Math.PI) / 2)
    case 'out':
      return Math.sin((c * Math.PI) / 2)
    case 'hold':
      return 0
    case 'inOut':
    default:
      return 0.5 - 0.5 * Math.cos(Math.PI * c)
  }
}

/** Snapshot of one keyframe as a frame: rotations copied, offsets kept to root boxes. */
function frameOfKey(key: ClipKey, roots: Set<string>): PoseFrame {
  const rot = new Map<string, JointEuler>()
  const off = new Map<string, Coord>()
  for (const [id, e] of Object.entries(key.joints)) rot.set(id, [e[0], e[1], e[2]])
  for (const [id, o] of Object.entries(key.offsets ?? {})) {
    if (!roots.has(id)) continue
    off.set(id, [o[0], o[1], o[2]])
  }
  return { rot, off }
}

const BIND_EULER: JointEuler = [0, 0, 0]

/**
 * Blends two frames at eased phase `phase`: rotations slerp per joint (shortest path,
 * like the pose cycle), offsets lerp componentwise. A joint missing on one side blends
 * from/to bind. Exact 0/1 skip the quaternion round-trip so key instants read bit-clean.
 */
function blendPoseFrames(a: PoseFrame, b: PoseFrame, phase: number): PoseFrame {
  const rot = new Map<string, JointEuler>()
  for (const id of new Set([...a.rot.keys(), ...b.rot.keys()])) {
    const ea = a.rot.get(id) ?? BIND_EULER
    const eb = b.rot.get(id) ?? BIND_EULER
    if (phase <= 0) rot.set(id, [ea[0], ea[1], ea[2]])
    else if (phase >= 1) rot.set(id, [eb[0], eb[1], eb[2]])
    else {
      const q = eulerToQuaternion(ea).slerp(eulerToQuaternion(eb), phase)
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
      rot.set(id, [e.x, e.y, e.z])
    }
  }
  const off = new Map<string, Coord>()
  for (const id of new Set([...a.off.keys(), ...b.off.keys()])) {
    const oa = a.off.get(id) ?? [0, 0, 0]
    const ob = b.off.get(id) ?? [0, 0, 0]
    off.set(id, [oa[0] + (ob[0] - oa[0]) * phase, oa[1] + (ob[1] - oa[1]) * phase, oa[2] + (ob[2] - oa[2]) * phase])
  }
  return { rot, off }
}

/**
 * Evaluates a clip at clip-local seconds `t`: the segment's phase runs through the
 * OUTGOING key's ease (`hold` steps). A looping clip wraps the last key back to the first
 * over `duration − lastKey.time` (seamless when the wrap lands on the first keyframe); a
 * non-looping clip holds its last key past the end and its first key before the start
 * (negative `t`). Total: an empty clip yields an empty (bind) frame.
 */
export function evaluateClip(boxes: RigBox[], clip: RigClip, t: number): PoseFrame {
  const keys = [...clip.keys].sort((a, b) => a.time - b.time)
  if (keys.length === 0) return { rot: new Map(), off: new Map() }
  const roots = new Set<string>()
  for (const b of boxes) if (b.parentId == null) roots.add(b.id)
  const snapshot = (key: ClipKey): PoseFrame => frameOfKey(key, roots)

  let time = t
  if (clip.loop && clip.duration > 0) time = ((t % clip.duration) + clip.duration) % clip.duration
  if (!Number.isFinite(time) || time <= keys[0].time) return snapshot(keys[0])
  const last = keys[keys.length - 1]
  if (time >= last.time) {
    if (clip.loop && keys.length > 1 && clip.duration > last.time) {
      const span = clip.duration - last.time
      return blendPoseFrames(snapshot(last), snapshot(keys[0]), easePhase(last.ease, (time - last.time) / span))
    }
    return snapshot(last)
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const from = keys[i]
    const to = keys[i + 1]
    if (time >= from.time && time < to.time) {
      const span = to.time - from.time
      // Coincident keys (only via unsanitized input — the sanitizer sorts and the frame
      // grid keeps distinct times distinct): jump to the later key rather than divide by 0.
      if (span <= 0) return snapshot(to)
      return blendPoseFrames(snapshot(from), snapshot(to), easePhase(from.ease, (time - from.time) / span))
    }
  }
  return snapshot(last)
}

/**
 * Sampled key payload at clip-local seconds `t`: the blended rotations + root offsets
 * as plain key records, so freezing a mid-tween frame into a key keeps the visible
 * pose. Values stay verbatim (no degree-snapping — the snapshot lies exactly on the
 * curve); linear and hold spans reproduce bit-clean through the split, eased spans
 * keep the frame and inherit the segment's ease around the new key.
 */
export function sampleKeyPayload(
  boxes: RigBox[],
  clip: RigClip,
  t: number,
): { joints: KeyJoints; offsets: KeyOffsets } {
  const frame = evaluateClip(boxes, clip, t)
  const joints: KeyJoints = {}
  for (const [id, e] of frame.rot) joints[id] = [e[0], e[1], e[2]]
  const offsets: KeyOffsets = {}
  for (const [id, o] of frame.off) offsets[id] = [o[0], o[1], o[2]]
  return { joints, offsets }
}

/**
 * Converts a legacy from/to pose cycle into a two-key clip named `cycle` (the step-2
 * migration shape, now embedding the poses' joints — the pose is the keyframe):
 * `once` becomes a non-looping in-out segment over one half cycle; `loop` and
 * `pingpong` both become seamless out-and-back loops (from@0, to@half, duration
 * 2×half) with in-out keys — the old `loop` mode's B→A pop goes away on purpose.
 * Key names inherit the poses' names. Unknown pose ids embed empty (bind) joints.
 */
export function clipFromPoseCycle(
  cycle: { fromId: string; toId: string; mode: 'once' | 'loop' | 'pingpong'; speed: 1 | 2 | 3 },
  poses: Array<{ id: string; name: string; joints?: KeyJoints; offsets?: KeyOffsets }>,
): RigClip {
  const half = snapClipTime(BASE_CYCLE_SECONDS / cycle.speed)
  const loop = cycle.mode !== 'once'
  const byId = new Map(poses.map((p) => [p.id, p]))
  const key = (poseId: string, time: number): ClipKey => {
    const pose = byId.get(poseId)
    const offsets = pose?.offsets && Object.keys(pose.offsets).length > 0 ? { ...pose.offsets } : undefined
    return {
      id: newKeyId(),
      name: pose?.name ?? 'Key',
      time,
      ease: 'inOut',
      joints: { ...(pose?.joints ?? {}) },
      ...(offsets ? { offsets } : {}),
    }
  }
  return {
    id: newClipId(),
    name: 'cycle',
    loop,
    duration: Math.max(loop ? half * 2 : half, CLIP_FRAME_SECONDS),
    keys: [key(cycle.fromId, 0), key(cycle.toId, half)],
  }
}

/**
 * Derives a project's animation mode from its data (persistence migration default):
 * poses with no enabled tween mean poses; anything else (tweens present, or neither
 * system in use) means tweens.
 */
export function deriveAnimationMode(args: {
  rigBoxes: RigBox[]
  poses: unknown[]
}): AnimationMode {
  if (args.poses.length > 0 && !hasActiveTweens(args.rigBoxes)) return 'poses'
  return 'tweens'
}
