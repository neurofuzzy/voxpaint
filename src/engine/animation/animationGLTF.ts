import * as THREE from 'three'
import type { Axis } from '@/engine/grid/types'
import type { SliceAnimSettings, SliceKey } from './types'
import { isRotateMode, isSlideMode, sliceWorldBasis } from './animationLayers'

const BASE_CYCLE_SECONDS = 2

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

  const dir = settings.animationType === 'slide-horizontal' ? uDir : vDir

  const times = new Float32Array([0, duration / 4, duration / 2, duration * 3 / 4, duration])

  const posCenter = center.clone()
  const posPlus = center.clone().addScaledVector(dir, amplitude)
  const posMinus = center.clone().addScaledVector(dir, -amplitude)

  const values = new Float32Array(3 * 5)

  posCenter.toArray(values, 0)
  posPlus.toArray(values, 3)
  posCenter.toArray(values, 6)
  posMinus.toArray(values, 9)
  posCenter.toArray(values, 12)

  const timesArr = Array.from(times)
  const valuesArr = Array.from(values)

  const track = new THREE.VectorKeyframeTrack(
    `${node.name}.position`,
    timesArr,
    valuesArr,
    THREE.InterpolateLinear,
  )

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
