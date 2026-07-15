import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import type { Axis, CellKey, VoxelModel } from '@/engine/grid/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { outwardNormal } from '@/engine/plane/planeGeometry'
import type { AnimLayer, AnimationType, SliceAnimSettings, SliceKey } from './types'

export function encodeSliceKey(axis: Axis, offset: number): SliceKey {
  return `${axis},${offset}`
}

export function decodeSliceKey(key: SliceKey): { axis: Axis; offset: number } {
  const [axis, offsetStr] = key.split(',')
  return { axis: axis as Axis, offset: Number(offsetStr) }
}

export function sliceKeyFromPlane(axis: Axis, offset: number): SliceKey {
  return encodeSliceKey(axis, offset)
}

export function isActiveAnimation(type: AnimationType): boolean {
  return type !== 'none'
}

/** True iff at least one slice has an active (non-'none') animation. Settings can persist with
 * animationType 'none' (e.g. speed adjusted before an animation type is chosen), so callers
 * deciding whether to switch into the animated render/export path must check this rather than
 * `animSettings.size > 0`. */
export function hasActiveAnimations(animSettings: Map<SliceKey, SliceAnimSettings>): boolean {
  for (const settings of animSettings.values()) {
    if (isActiveAnimation(settings.animationType)) return true
  }
  return false
}

export function isSlideMode(type: AnimationType): boolean {
  return type === 'slide-vertical' || type === 'slide-vertical-rev' || type === 'slide-horizontal' || type === 'slide-horizontal-rev'
}

export function isRotateMode(type: AnimationType): boolean {
  return type === 'rotate-cw' || type === 'rotate-ccw'
}

export function isPendulumMode(type: AnimationType): boolean {
  return type === 'pendulum' || type === 'pendulum-rev'
}

/** Signed direction vector for a slide mode: base axis (uDir for horizontal, vDir for vertical)
 * negated for the `-rev` variant, so the phase of the shared sine wave flips. */
export function slideDirection(type: AnimationType, uDir: THREE.Vector3, vDir: THREE.Vector3): THREE.Vector3 {
  const horizontal = type === 'slide-horizontal' || type === 'slide-horizontal-rev'
  const base = horizontal ? uDir : vDir
  const reversed = type === 'slide-horizontal-rev' || type === 'slide-vertical-rev'
  return reversed ? base.clone().negate() : base.clone()
}

export function sliceVoxelKeys(model: VoxelModel, axis: Axis, offset: number): CellKey[] {
  const ai = axisIndex(axis)
  const keys: CellKey[] = []
  for (const key of model.color.keys()) {
    const coord = decodeKey(key)
    if (coord[ai] === offset) keys.push(key)
  }
  return keys
}

export function bboxCenterOfKeys(keys: CellKey[]): THREE.Vector3 | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let found = false

  for (const key of keys) {
    const coord = decodeKey(key)
    found = true
    const cx = coord[0], cy = coord[1], cz = coord[2]
    if (cx < minX) minX = cx
    if (cy < minY) minY = cy
    if (cz < minZ) minZ = cz
    if (cx + 1 > maxX) maxX = cx + 1
    if (cy + 1 > maxY) maxY = cy + 1
    if (cz + 1 > maxZ) maxZ = cz + 1
  }

  if (!found) return null
  return new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
}

export function sliceBBoxCenter(model: VoxelModel, axis: Axis, offset: number): THREE.Vector3 | null {
  return bboxCenterOfKeys(sliceVoxelKeys(model, axis, offset))
}

/** Rotation/pendulum node center: an explicit per-slice pivot cell (its +0.5 cell-center) when one
 * is set for this slice, else the slice's painted-voxel bbox center. Slide modes always use the
 * bbox center (pivots don't apply there). Returns null only when the slice has no voxels and no
 * pivot is set. */
export function resolveAnimCenter(
  cellKeys: CellKey[],
  axis: Axis,
  offset: number,
  animationType: AnimationType,
  slicePivots: Map<SliceKey, CellKey> | undefined,
): THREE.Vector3 | null {
  if ((isRotateMode(animationType) || isPendulumMode(animationType)) && slicePivots) {
    const pivotKey = slicePivots.get(encodeSliceKey(axis, offset))
    if (pivotKey) {
      const [x, y, z] = decodeKey(pivotKey)
      return new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5)
    }
  }
  return bboxCenterOfKeys(cellKeys)
}

export function sliceWorldBasis(axis: Axis): { uDir: THREE.Vector3; vDir: THREE.Vector3; normal: THREE.Vector3 } {
  const { uDir, vDir } = planeLogicalBasis(axis)
  const n = outwardNormal(axis, 1)
  return {
    uDir: new THREE.Vector3(uDir[0], uDir[1], uDir[2]),
    vDir: new THREE.Vector3(vDir[0], vDir[1], vDir[2]),
    normal: new THREE.Vector3(n[0], n[1], n[2]),
  }
}

/** Shared with the glTF export (animationGLTF.ts) so live preview and exported clips agree on timing. */
export const BASE_CYCLE_SECONDS = 2

/**
 * Per-frame transform for one animated slice group's live preview, matching the CUBICSPLINE curve
 * baked into the glTF export (animationGLTF.ts) — a sine wave for slide, constant angular velocity
 * for rotate — so the preview always agrees with the exported motion.
 */
export function updateAnimatedGroupTransform(
  group: THREE.Group,
  center: THREE.Vector3,
  axis: Axis,
  settings: SliceAnimSettings,
  elapsedSeconds: number,
): void {
  const duration = BASE_CYCLE_SECONDS / settings.speed
  const t = (elapsedSeconds % duration) / duration

  if (isRotateMode(settings.animationType)) {
    const { normal } = sliceWorldBasis(axis)
    const angle = settings.animationType === 'rotate-cw' ? t * Math.PI * 2 : -t * Math.PI * 2
    group.position.copy(center)
    group.quaternion.setFromAxisAngle(normal, angle)
  } else if (isSlideMode(settings.animationType)) {
    const { uDir, vDir } = sliceWorldBasis(axis)
    const dir = slideDirection(settings.animationType, uDir, vDir)
    const amplitude = settings.slideAmount
    const offset = Math.sin(t * Math.PI * 2)
    group.position.copy(center).addScaledVector(dir, offset * amplitude)
    group.quaternion.identity()
  } else if (isPendulumMode(settings.animationType)) {
    const { normal } = sliceWorldBasis(axis)
    const sign = settings.animationType === 'pendulum' ? 1 : -1
    const angle = sign * THREE.MathUtils.degToRad(settings.swingAmount) * Math.sin(t * Math.PI * 2)
    group.position.copy(center)
    group.quaternion.setFromAxisAngle(normal, angle)
  }
}

const AXIS_PRIORITY: Axis[] = ['x', 'y', 'z']

export function assignVoxelsToNodes(
  model: VoxelModel,
  animSettings: Map<SliceKey, SliceAnimSettings>,
  sliceMasks?: Map<SliceKey, Set<CellKey>>,
): { nodes: Map<SliceKey, { cellKeys: CellKey[]; axis: Axis; offset: number }>; remainder: CellKey[] } {
  const nodes = new Map<SliceKey, { cellKeys: CellKey[]; axis: Axis; offset: number }>()
  const assigned = new Set<CellKey>()
  const sortedLayers: AnimLayer[] = []

  for (const [key, settings] of animSettings) {
    if (!isActiveAnimation(settings.animationType)) continue
    const { axis, offset } = decodeSliceKey(key)
    sortedLayers.push({ axis, offset, settings })
  }

  sortedLayers.sort((a, b) => {
    const ai = AXIS_PRIORITY.indexOf(a.axis)
    const bi = AXIS_PRIORITY.indexOf(b.axis)
    if (ai !== bi) return ai - bi
    return a.offset - b.offset
  })

  for (const layer of sortedLayers) {
    const sliceKey = encodeSliceKey(layer.axis, layer.offset)
    // A non-empty mask paints a subset of the slice to animate; an unpainted (absent or empty)
    // mask keeps the original whole-slice behavior.
    const mask = sliceMasks?.get(sliceKey)
    const candidates = sliceVoxelKeys(model, layer.axis, layer.offset)
    const cellKeys: CellKey[] = []
    for (const key of candidates) {
      if (mask && mask.size > 0 && !mask.has(key)) continue
      if (!assigned.has(key)) {
        assigned.add(key)
        cellKeys.push(key)
      }
    }
    if (cellKeys.length > 0) {
      nodes.set(sliceKey, { cellKeys, axis: layer.axis, offset: layer.offset })
    }
  }

  const remainder: CellKey[] = []
  for (const key of model.color.keys()) {
    if (!assigned.has(key)) remainder.push(key)
  }

  return { nodes, remainder }
}

export function defaultAnimationSettings(): SliceAnimSettings {
  return { animationType: 'none', speed: 1, slideAmount: 4, swingAmount: 30 }
}

export const SLIDE_AMOUNT_MIN = 1
export const SLIDE_AMOUNT_MAX = 8

export const PENDULUM_AMOUNT_MIN = 5
export const PENDULUM_AMOUNT_MAX = 90
