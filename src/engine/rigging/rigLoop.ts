import * as THREE from 'three'
import type { Axis } from '@/engine/grid/types'
import type { AnimationSpeed } from '@/engine/animation/types'
import { BASE_CYCLE_SECONDS } from '@/engine/animation/animationLayers'
import { rigPivotOf, type RigBox, type RigLoop } from './types'

const AXIS_UNIT: Record<Axis, [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

/** Default loop for a freshly-enabled box: a 1x turntable spin about world Y. */
export function defaultRigLoop(): RigLoop {
  return { kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4 }
}

export function isLoopActive(loop: RigLoop | null | undefined): loop is RigLoop {
  return !!loop && (loop.kind === 'rotate' || loop.kind === 'slide')
}

export function hasActiveRigLoops(boxes: RigBox[]): boolean {
  return boxes.some((b) => isLoopActive(b.loop))
}

/** A loop's rotation center in world units: the box pivot's +0.5 cell-center offset. */
export function resolveRigLoopCenter(box: RigBox): THREE.Vector3 {
  const p = rigPivotOf(box)
  return new THREE.Vector3(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5)
}

/**
 * One box's local loop matrix at `elapsedSeconds` (world-frame rigid transform, already
 * pivot-relative for rotate). Identity when the loop is null/inactive — so unlooped boxes
 * cost nothing in the per-frame compose below.
 */
export function localLoopMatrix(box: RigBox, loop: RigLoop | null | undefined, elapsedSeconds: number): THREE.Matrix4 {
  const out = new THREE.Matrix4()
  if (!isLoopActive(loop)) return out
  const l = loop as RigLoop
  const duration = BASE_CYCLE_SECONDS / l.speed
  const t = (elapsedSeconds % duration) / duration
  if (l.kind === 'rotate') {
    const pivot = rigPivotOf(box)
    const pw = new THREE.Vector3(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5)
    const axis = new THREE.Vector3(...AXIS_UNIT[l.axis])
    const angle = l.direction * t * Math.PI * 2
    const r = new THREE.Matrix4().makeRotationAxis(axis, angle)
    const tr = new THREE.Matrix4().makeTranslation(pw.x, pw.y, pw.z)
    const tn = new THREE.Matrix4().makeTranslation(-pw.x, -pw.y, -pw.z)
    return out.multiplyMatrices(tr, r).multiply(tn)
  }
  const axis = new THREE.Vector3(...AXIS_UNIT[l.axis])
  const offset = l.direction * l.amount * Math.sin(t * Math.PI * 2)
  return out.makeTranslation(axis.x * offset, axis.y * offset, axis.z * offset)
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
 * Looped world matrix per box: ancestors' loop locals composed root-first (a looped parent
 * carries its whole subtree, exactly like the pose chain in `pose.ts`), then the box's own
 * local. Unlooped boxes map to identity — callers can skip them or write identity cheaply.
 */
export function composeLoopMatrices(
  boxes: RigBox[],
  elapsedSeconds: number,
): Map<string, THREE.Matrix4> {
  const out = new Map<string, THREE.Matrix4>()
  for (const box of boxes) {
    const chain = ancestorChain(boxes, box)
    const m = new THREE.Matrix4()
    for (const b of chain) {
      m.multiply(localLoopMatrix(b, b.loop, elapsedSeconds))
    }
    out.set(box.id, m)
  }
  return out
}

/**
 * Per-frame transform for one looped joint group in the pose-view scene graph (mirrors
 * `updateAnimatedGroupTransform` for slices): the group sits at the loop center, so the
 * mesh inside is recentered by `-center` at build time and only TRS is driven here.
 */
export function updateRigLoopGroupTransform(
  group: THREE.Group,
  box: RigBox,
  loop: RigLoop,
  elapsedSeconds: number,
): void {
  const center = resolveRigLoopCenter(box)
  const duration = BASE_CYCLE_SECONDS / loop.speed
  const t = (elapsedSeconds % duration) / duration
  if (loop.kind === 'rotate') {
    const axis = new THREE.Vector3(...AXIS_UNIT[loop.axis])
    group.position.copy(center)
    group.quaternion.setFromAxisAngle(axis, loop.direction * t * Math.PI * 2)
  } else {
    const axis = new THREE.Vector3(...AXIS_UNIT[loop.axis])
    const offset = Math.sin(t * Math.PI * 2) * loop.amount
    group.position.copy(center).addScaledVector(axis, loop.direction * offset)
    group.quaternion.identity()
  }
}

/** Signed angle/direction helpers shared with the clip builder below. */
export function loopDuration(speed: AnimationSpeed): number {
  return BASE_CYCLE_SECONDS / speed
}

/** glTF CUBICSPLINE Hermite evaluator (spec appendix C) — mirrors `animationGLTF.ts`'s
 * private interpolant, which isn't exported. Sample values are laid out per keyframe as
 * `[inTangent, value, outTangent]`; stored tangents are raw derivatives scaled here by
 * the interval duration, matching the spec formula. */
class CubicSplineVectorInterpolant extends THREE.Interpolant {
  interpolate_(i1: number, t0: number, t: number, t1: number): Float32Array {
    const result = this.resultBuffer as Float32Array
    const values = this.sampleValues as Float32Array
    const stride = this.valueSize
    const stride2 = stride * 2
    const stride3 = stride * 3
    const td = t1 - t0
    const p = (t - t0) / td
    const pp = p * p
    const ppp = pp * p
    const offset1 = i1 * stride3
    const offset0 = offset1 - stride3
    const s2 = -2 * ppp + 3 * pp
    const s3 = ppp - pp
    const s0 = 1 - s2
    const s1 = s3 - pp + p
    for (let i = 0; i !== stride; i++) {
      const p0 = values[offset0 + i + stride]
      const m0 = values[offset0 + i + stride2] * td
      const p1 = values[offset1 + i + stride]
      const m1 = values[offset1 + i] * td
      result[i] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1
    }
    return result
  }
}

/** Marks `track` so `GLTFExporter` serializes it with `interpolation: "CUBICSPLINE"`. */
function markCubicSpline(track: THREE.VectorKeyframeTrack | THREE.QuaternionKeyframeTrack): void {
  const t = track as unknown as { createInterpolant: ((result?: Float32Array) => THREE.Interpolant) & { isInterpolantFactoryMethodGLTFCubicSpline?: boolean } }
  t.createInterpolant = function (this: THREE.VectorKeyframeTrack | THREE.QuaternionKeyframeTrack, result?: Float32Array) {
    return new CubicSplineVectorInterpolant(this.times, this.values, this.getValueSize() / 3, result)
  } as typeof t.createInterpolant
  t.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline = true
}

/**
 * glTF clip for one looped joint. Rotation is a 3-keyframe linear loop (full 2π/cycle);
 * slide is a 5-keyframe CUBICSPLINE sine with analytic tangents — the same encodings the
 * slice-loop path (`animationGLTF.ts`) uses, so preview and export agree exactly.
 */
export function buildRigLoopClip(
  node: THREE.Group,
  loop: RigLoop,
  center: THREE.Vector3,
  voxelScaleY = 1,
): THREE.AnimationClip | null {
  if (!isLoopActive(loop)) return null
  const duration = loopDuration(loop.speed)
  if (loop.kind === 'rotate') {
    const axis = new THREE.Vector3(...AXIS_UNIT[loop.axis])
    const angle = loop.direction * Math.PI * 2
    const times = new Float32Array([0, duration / 2, duration])
    const values = new Float32Array(12)
    new THREE.Quaternion().toArray(values as unknown as number[], 0)
    new THREE.Quaternion().setFromAxisAngle(axis, angle / 2).toArray(values as unknown as number[], 4)
    new THREE.Quaternion().setFromAxisAngle(axis, angle).toArray(values as unknown as number[], 8)
    const track = new THREE.QuaternionKeyframeTrack(
      `${node.name}.quaternion`,
      times as unknown as number[],
      values as unknown as number[],
      THREE.InterpolateLinear,
    )
    return new THREE.AnimationClip(`anim_${node.name}`, duration, [track])
  }
  const axis = new THREE.Vector3(...AXIS_UNIT[loop.axis])
  // The joint's rest position lives in Y-scaled export space (see buildRigTree), so the
  // slide offset scales along Y to match — exactly like the slice path's scaled centers.
  const dir = axis.clone().multiplyScalar(loop.direction)
  dir.y *= voxelScaleY
  const omega = (2 * Math.PI) / duration
  const times = [0, duration / 4, duration / 2, (duration * 3) / 4, duration]
  const values: number[] = []
  for (const t of times) {
    const pos = center.clone().addScaledVector(dir, loop.amount * Math.sin(omega * t))
    const tangent = dir.clone().multiplyScalar(loop.amount * omega * Math.cos(omega * t))
    values.push(tangent.x, tangent.y, tangent.z, pos.x, pos.y, pos.z, tangent.x, tangent.y, tangent.z)
  }
  const track = new THREE.VectorKeyframeTrack(`${node.name}.position`, times, values)
  markCubicSpline(track)
  return new THREE.AnimationClip(`anim_${node.name}`, duration, [track])
}


