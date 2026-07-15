import * as THREE from 'three'
import type { Axis } from '@/engine/grid/types'
import type { SliceAnimSettings, SliceKey } from './types'
import { BASE_CYCLE_SECONDS, isRotateMode, isSlideMode, slideDirection, sliceWorldBasis } from './animationLayers'

function cycleDuration(speed: number): number {
  return BASE_CYCLE_SECONDS / speed
}

export interface AnimNodeInfo {
  node: THREE.Group
  sliceKey: SliceKey
  settings: SliceAnimSettings
  axis: Axis
  center: THREE.Vector3
}

/**
 * glTF CUBICSPLINE Hermite evaluator (spec: appendix C, "Spline Interpolation"). Sample values are
 * laid out per keyframe as `[inTangent, value, outTangent]`; stored tangents are raw derivatives —
 * this scales them by the interval duration itself, matching the spec formula. Mirrors (but is
 * independent of) `GLTFCubicSplineInterpolant` in three's `GLTFLoader.js`, which isn't part of
 * three's public API.
 */
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
      const p0 = values[offset0 + i + stride] // splineVertex_k
      const m0 = values[offset0 + i + stride2] * td // outTangent_k * (t_k+1 - t_k)
      const p1 = values[offset1 + i + stride] // splineVertex_k+1
      const m1 = values[offset1 + i] * td // inTangent_k+1 * (t_k+1 - t_k)
      result[i] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1
    }

    return result
  }
}

/** Marks `track` so `GLTFExporter` serializes it with `interpolation: "CUBICSPLINE"` — it checks
 * `track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline`, a per-instance flag rather
 * than a `getInterpolation()` value, since `createInterpolant` isn't in `KeyframeTrack`'s public
 * type surface. `track.values` must already be laid out as `[inTangent, value, outTangent]` triples
 * per keyframe before calling this. */
function markCubicSpline(track: THREE.VectorKeyframeTrack): void {
  const t = track as unknown as { createInterpolant: ((result?: Float32Array) => THREE.Interpolant) & { isInterpolantFactoryMethodGLTFCubicSpline?: boolean } }
  t.createInterpolant = function (this: THREE.VectorKeyframeTrack, result?: Float32Array) {
    return new CubicSplineVectorInterpolant(this.times, this.values, this.getValueSize() / 3, result)
  } as typeof t.createInterpolant
  t.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline = true
}

function buildRotationClip(
  node: THREE.Group,
  settings: SliceAnimSettings,
  axis: Axis,
  _center: THREE.Vector3,
): THREE.AnimationClip {
  const duration = cycleDuration(settings.speed)
  const { normal } = sliceWorldBasis(axis)
  const angle = settings.animationType === 'rotate-cw' ? Math.PI * 2 : -Math.PI * 2

  const times = new Float32Array([0, duration / 2, duration])
  const values = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])

  const q0 = new THREE.Quaternion()
  const qHalf = new THREE.Quaternion().setFromAxisAngle(normal, angle / 2)
  const qFull = new THREE.Quaternion().setFromAxisAngle(normal, angle)

  q0.toArray(values, 0)
  qHalf.toArray(values, 4)
  qFull.toArray(values, 8)

  const track = new THREE.QuaternionKeyframeTrack(
    `${node.name}.quaternion`,
    times as unknown as number[],
    values as unknown as number[],
    THREE.InterpolateLinear,
  )

  return new THREE.AnimationClip(`anim_${node.name}`, duration, [track])
}

function buildTranslationClip(
  node: THREE.Group,
  settings: SliceAnimSettings,
  axis: Axis,
  center: THREE.Vector3,
): THREE.AnimationClip {
  const duration = cycleDuration(settings.speed)
  const amplitude = settings.slideAmount
  const { uDir, vDir } = sliceWorldBasis(axis)

  const dir = slideDirection(settings.animationType, uDir, vDir)

  // Slide motion is an exact sine wave, position(t) = center + amplitude·sin(ωt)·dir — these 5
  // sample times land exactly on its zero-crossings and extrema. CUBICSPLINE keyframes store
  // [inTangent, value, outTangent] per key; using the analytic derivative amplitude·ω·cos(ωt) as
  // both tangents reproduces the sine curve exactly (zero tangent at the ± extrema) and keeps the
  // loop C¹-continuous at the wrap (t=0 and t=duration share the same tangent).
  const omega = (2 * Math.PI) / duration
  const times = [0, duration / 4, duration / 2, (duration * 3) / 4, duration]

  const values: number[] = []
  for (const t of times) {
    const pos = center.clone().addScaledVector(dir, amplitude * Math.sin(omega * t))
    const tangent = dir.clone().multiplyScalar(amplitude * omega * Math.cos(omega * t))
    values.push(tangent.x, tangent.y, tangent.z)
    values.push(pos.x, pos.y, pos.z)
    values.push(tangent.x, tangent.y, tangent.z)
  }

  const track = new THREE.VectorKeyframeTrack(`${node.name}.position`, times, values)
  markCubicSpline(track)

  return new THREE.AnimationClip(`anim_${node.name}`, duration, [track])
}

export function buildAnimationClip(
  node: THREE.Group,
  settings: SliceAnimSettings,
  axis: Axis,
  center: THREE.Vector3,
): THREE.AnimationClip | null {
  if (isRotateMode(settings.animationType)) {
    return buildRotationClip(node, settings, axis, center)
  }
  if (isSlideMode(settings.animationType)) {
    return buildTranslationClip(node, settings, axis, center)
  }
  return null
}

export function buildAllAnimationClips(nodes: AnimNodeInfo[]): THREE.AnimationClip[] {
  const clips: THREE.AnimationClip[] = []
  for (const info of nodes) {
    const clip = buildAnimationClip(info.node, info.settings, info.axis, info.center)
    if (clip) clips.push(clip)
  }
  return clips
}
