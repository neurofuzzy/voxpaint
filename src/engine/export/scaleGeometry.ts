import * as THREE from 'three'

const yScaleMatrix = new THREE.Matrix4()

/**
 * Bakes the project-level Y voxel scale into already-built world-space export geometry
 * (positions and normals — `applyMatrix4` renormalizes normals through the normal matrix, so
 * lighting survives the non-uniform squash/stretch). Deliberately the *last* geometry step
 * before anchor computation: every bake upstream (blend atlas, AO/uv1 unwrap, specular noise)
 * runs in unit-cube voxel units and stays untouched, UVs stay glued to their faces (they were
 * derived from the same unscaled vertices), and anchors/bounds then operate on true scaled
 * extents with no special-casing. No-op at 1x.
 */
export function scaleGeometryY(geometry: THREE.BufferGeometry, voxelScaleY: number): void {
  if (voxelScaleY === 1) return
  yScaleMatrix.makeScale(1, voxelScaleY, 1)
  geometry.applyMatrix4(yScaleMatrix)
}
