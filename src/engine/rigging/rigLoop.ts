import * as THREE from 'three'
import type { Axis, Coord } from '@/engine/grid/types'
import type { AnimationSpeed } from '@/engine/animation/types'
import { BASE_CYCLE_SECONDS } from '@/engine/animation/animationLayers'
import { newTweenId, rigPivotOf, type RigBox, type RigTween } from './types'
import { composePoseMatrices, type JointEuler } from './pose'

const AXIS_UNIT: Record<Axis, [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

/**
 * Every tween period divides the 2s base cycle (speeds 1/2/3 → periods 2/1/⅔s), so any
 * stack — any box, any combination — repeats exactly every 2 seconds. The exporter bakes
 * over this window (see `bakeRigClips`); nothing ever drifts.
 */
export const TWEEN_CYCLE_SECONDS = BASE_CYCLE_SECONDS

/** A fresh enabled turntable spin about world Y — what "add tween" starts from. */
export function newRigTween(): RigTween {
  return { id: newTweenId(), kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4, enabled: true }
}

export function isTweenActive(tween: RigTween | null | undefined): tween is RigTween {
  return !!tween && tween.enabled && (tween.kind === 'rotate' || tween.kind === 'slide')
}

/** Enabled tweens of a box, in stack order. Absent array = no tweens. */
export function activeTweens(box: RigBox): RigTween[] {
  return (box.tweens ?? []).filter(isTweenActive)
}

export function boxHasActiveTweens(box: RigBox): boolean {
  return activeTweens(box).length > 0
}

export function hasActiveTweens(boxes: RigBox[]): boolean {
  return boxes.some(boxHasActiveTweens)
}

/**
 * Self or any ancestor has an enabled tween. Pose interaction (rings, ring/trackball
 * drags) needs a static frame — the drag math samples the bind/pose-only parent chain —
 * so a tweened chain can't be posed until its tweens mute. The pose *value* itself stays
 * well-defined under motion (world = loop × pose); only targeting it is disabled.
 */
export function chainHasActiveTweens(boxes: RigBox[], box: RigBox): boolean {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  let cur: RigBox | undefined = box
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    if (boxHasActiveTweens(cur)) return true
    seen.add(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return false
}

/**
 * Full animated world matrix per box: tween-chain × pose-chain. The single choke point
 * for everything that must track motion — voxel meshes (RigPoseView), wire outlines,
 * pivot markers, and parent→child links all read these, so chrome can never disagree
 * with the model about where a joint is.
 */
export function composeAnimatedMatrices(
  boxes: RigBox[],
  poseRotations: Map<string, JointEuler>,
  elapsedSeconds: number,
): Map<string, THREE.Matrix4> {
  const loops = composeTweenMatrices(boxes, elapsedSeconds)
  const poses = composePoseMatrices(boxes, poseRotations)
  const out = new Map<string, THREE.Matrix4>()
  for (const box of boxes) {
    out.set(box.id, loops.get(box.id)!.multiply(poses.get(box.id)!))
  }
  return out
}

/**
 * A box's pivot in world space under full animation: its own local fixes its own pivot
 * (rotation about / translation of the joint never moves its own center), so the combined
 * world matrix carries the pivot exactly where the joint is.
 */
export function pivotWorldFromMatrix(matrix: THREE.Matrix4, box: RigBox): Coord {
  const pivot = rigPivotOf(box)
  const v = new THREE.Vector3(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5).applyMatrix4(matrix)
  return [v.x, v.y, v.z]
}

/**
 * One tween's local matrix at `elapsedSeconds` (world-frame rigid transform, already
 * pivot-relative for rotate). Identity for disabled tweens — muted entries cost nothing.
 */
export function localTweenMatrix(box: RigBox, tween: RigTween, elapsedSeconds: number): THREE.Matrix4 {
  const out = new THREE.Matrix4()
  if (!isTweenActive(tween)) return out
  const duration = BASE_CYCLE_SECONDS / tween.speed
  const t = (elapsedSeconds % duration) / duration
  if (tween.kind === 'rotate') {
    const pivot = rigPivotOf(box)
    const pw = new THREE.Vector3(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5)
    const axis = new THREE.Vector3(...AXIS_UNIT[tween.axis])
    const r = new THREE.Matrix4().makeRotationAxis(axis, tween.direction * t * Math.PI * 2)
    const tr = new THREE.Matrix4().makeTranslation(pw.x, pw.y, pw.z)
    const tn = new THREE.Matrix4().makeTranslation(-pw.x, -pw.y, -pw.z)
    return out.multiplyMatrices(tr, r).multiply(tn)
  }
  const axis = new THREE.Vector3(...AXIS_UNIT[tween.axis])
  const offset = tween.direction * tween.amount * Math.sin(t * Math.PI * 2)
  return out.makeTranslation(axis.x * offset, axis.y * offset, axis.z * offset)
}

/**
 * One box's own motion at time t: enabled tweens folded top-first. Stack order is
 * load-bearing — rotations don't commute — so the array order IS the composition order
 * (first entry = outermost). Identity when nothing is enabled.
 */
export function boxTweenMatrix(box: RigBox, elapsedSeconds: number): THREE.Matrix4 {
  const out = new THREE.Matrix4()
  for (const tween of activeTweens(box)) {
    out.multiply(localTweenMatrix(box, tween, elapsedSeconds))
  }
  return out
}

function ancestorChain(boxes: RigBox[], box: RigBox): RigBox[] {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const chain: RigBox[] = [box]
  const seen = new Set([box.id])
  let parentId = box.parentId
  while (parentId) {
    if (seen.has(parentId)) break
    const parent = byId.get(parentId)
    if (!parent) break
    chain.push(parent)
    seen.add(parentId)
    parentId = parent.parentId
  }
  return chain.reverse()
}

/**
 * Animated world matrix per box: ancestors' tween stacks composed root-first (an animated
 * parent carries its whole subtree), then the box's own stack. Unanimated boxes map to
 * identity.
 */
export function composeTweenMatrices(
  boxes: RigBox[],
  elapsedSeconds: number,
): Map<string, THREE.Matrix4> {
  const out = new Map<string, THREE.Matrix4>()
  for (const box of boxes) {
    const chain = ancestorChain(boxes, box)
    const m = new THREE.Matrix4()
    for (const b of chain) {
      m.multiply(boxTweenMatrix(b, elapsedSeconds))
    }
    out.set(box.id, m)
  }
  return out
}

/** Cycle length for a speed — shared with the slice-loop path's timing. */
export function tweenDuration(speed: AnimationSpeed): number {
  return BASE_CYCLE_SECONDS / speed
}

/**
 * Bakes one looping `AnimationClip` per animated joint by sampling the composed
 * (tween × pose) motion over the universal cycle (`TWEEN_CYCLE_SECONDS`, extended to
 * cover a pose cycle's full pass when one is provided). Each joint's track is
 * authored in its parent's *animated* frame —
 * `local(t) = T(−parentPivot) · parentMotion⁻¹(t) · selfMotion(t) · T(pivot)` (grid
 * units, identity at rest so clips start pop-free) — with Y scaled to export space on
 * write, matching the joint tree's rest translations. LINEAR TRS at 30fps: sub-voxel
 * error, plays in every downstream player (unlike N simultaneous analytic clips, which
 * no standard player composes).
 */
export function bakeRigClips(
  boxes: RigBox[],
  groups: Map<string, THREE.Group>,
  voxelScaleY = 1,
  fps = 30,
  pose?: { at: (t: number) => Map<string, JointEuler>; duration: number },
): THREE.AnimationClip[] {
  const posedIds = new Set(pose ? [...pose.at(0).keys()] : [])
  const animated = boxes.filter((b) => boxHasActiveTweens(b) || posedIds.has(b.id))
  if (animated.length === 0) return []
  // Static children ride animated parents through the hierarchy — no clip needed.
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const duration = Math.max(TWEEN_CYCLE_SECONDS, pose?.duration ?? 0)
  const steps = Math.round(duration * fps)
  const clips: THREE.AnimationClip[] = []
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  const parentInv = new THREE.Matrix4()
  const unparent = new THREE.Matrix4()
  const repivot = new THREE.Matrix4()
  const local = new THREE.Matrix4()

  for (const box of animated) {
    const group = groups.get(box.id)
    if (!group) continue
    const pivot = rigPivotOf(box)
    const parent = box.parentId ? byId.get(box.parentId) : undefined
    const parentPivot = parent ? rigPivotOf(parent) : null
    const times: number[] = []
    const positions: number[] = []
    const quaternions: number[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * duration
      const worlds = composeAnimatedMatrices(boxes, pose ? pose.at(t) : EMPTY_POSE, t)
      const self = worlds.get(box.id) ?? new THREE.Matrix4()
      const parentWorld = parent ? (worlds.get(parent.id) ?? new THREE.Matrix4()) : new THREE.Matrix4()
      // local(t) in grid units; translation Y scaled to export space on write.
      unparent.makeTranslation(
        parentPivot ? -(parentPivot[0] + 0.5) : 0,
        parentPivot ? -(parentPivot[1] + 0.5) : 0,
        parentPivot ? -(parentPivot[2] + 0.5) : 0,
      )
      repivot.makeTranslation(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5)
      parentInv.copy(parentWorld).invert()
      local.copy(unparent).multiply(parentInv).multiply(self).multiply(repivot)
      local.decompose(pos, quat, scl)
      times.push(t)
      positions.push(pos.x, pos.y * voxelScaleY, pos.z)
      quaternions.push(quat.x, quat.y, quat.z, quat.w)
    }
    const posTrack = new THREE.VectorKeyframeTrack(`${group.name}.position`, times, positions)
    const quatTrack = new THREE.QuaternionKeyframeTrack(`${group.name}.quaternion`, times, quaternions)
    clips.push(new THREE.AnimationClip(`anim_${group.name}`, duration, [posTrack, quatTrack]))
  }
  return clips
}

const EMPTY_POSE = new Map<string, JointEuler>()
