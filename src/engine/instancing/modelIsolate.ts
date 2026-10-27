import * as THREE from 'three'
import type { RigBox } from '@/engine/rigging/types'

/**
 * World-space clipping planes isolating one rig box's voxels: keeps [min, max + 1] per axis.
 * Y bounds are pre-scaled by `voxelScaleY` because the model renders under the Y-scale group
 * while clipping planes operate in world space. three.js discards fragments on the negative
 * side of each plane (`normal.dot(point) + constant < 0`).
 */
export function isolationPlanesForBox(box: RigBox, voxelScaleY: number): THREE.Plane[] {
  const [min, max] = [box.min, box.max]
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -min[0]),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), max[0] + 1),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -min[1] * voxelScaleY),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), (max[1] + 1) * voxelScaleY),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -min[2]),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), max[2] + 1),
  ]
}

const applied = new WeakMap<object, THREE.Plane[] | null>()

/**
 * Applies (or clears, with null) the isolation clip on model materials. Bumps `needsUpdate`
 * so the program recompiles with the new clipping-plane count — once per change, not per
 * render (identity-checked per material, so shared materials and repeat effects are free).
 */
export function setIsolationClip(materials: THREE.Material[], planes: THREE.Plane[] | null): void {
  for (const m of materials) {
    if (applied.get(m) === planes) continue
    applied.set(m, planes)
    m.clippingPlanes = planes
    m.needsUpdate = true
  }
}
