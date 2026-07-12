import * as THREE from 'three'
import type { Axis, Coord, Orientation } from '@/engine/grid/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { ALL_AXES, outwardNormal } from '@/engine/plane/planeGeometry'

function setFromCoord(v: THREE.Vector3, coord: Coord): THREE.Vector3 {
  return v.set(coord[0], coord[1], coord[2])
}

/**
 * Per-axis world-space (u,v) basis, derived (not hand-maintained) from
 * engine/plane/constructionPlane.ts's gridCoordFromPixel via planeLogicalBasis — see that
 * function's doc comment for the derivation. Computed once at module load, so this can never
 * drift out of sync with the 2D editor's own u/v mapping the way the old hand-copied
 * WORLD_U/WORLD_V tables repeatedly did.
 */
const PLANE_BASIS: Record<Axis, { worldU: THREE.Vector3; worldV: THREE.Vector3 }> = Object.fromEntries(
  ALL_AXES.map((axis) => {
    const { uDir, vDir } = planeLogicalBasis(axis)
    return [axis, { worldU: new THREE.Vector3(...uDir), worldV: new THREE.Vector3(...vDir) }]
  }),
) as Record<Axis, { worldU: THREE.Vector3; worldV: THREE.Vector3 }>

const scratchBasis = new THREE.Matrix4()
const scratchRotZ = new THREE.Matrix4()
const scratchOutward = new THREE.Vector3()
const scratchV = new THREE.Vector3()
const scratchCross = new THREE.Vector3()

/**
 * Placement matrix for a plain cube. Geometry is centered on the origin (see chamferGeometry.ts's
 * unitCubeGeometry), so the instance origin is the cell's 3D center — coord's min corner + (0.5).
 */
export function cubeInstanceMatrix(coord: Coord, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.makeTranslation(coord[0] + 0.5, coord[1] + 0.5, coord[2] + 0.5)
}

/**
 * True when `makeBasis(worldU, worldV, outward)` for this plane is a reflection (negative
 * determinant) rather than a proper rotation. Happens for exactly the (axis, orientation) combos
 * where the 2D editor's u/v frame is left-handed about the outward normal: +Z, +X, and -Y.
 *
 * A reflected instance matrix flips triangle winding in screen space, which inverts what the
 * fragment shader treats as the front face — so those chamfers would light as if lit from behind
 * (dark). InstancingManager routes reflected instances to a v-mirrored geometry pool paired with
 * the proper-rotation matrix chamferInstanceMatrix produces below, keeping every rendered instance
 * det=+1 and correctly lit. See chamferGeometry.ts's mirrorVGeometry.
 */
export function chamferBasisIsReflected(planeAxis: Axis, planeOrientation: Orientation): boolean {
  const { worldU, worldV } = PLANE_BASIS[planeAxis]
  setFromCoord(scratchOutward, outwardNormal(planeAxis, planeOrientation))
  scratchCross.crossVectors(worldV, scratchOutward)
  return worldU.dot(scratchCross) < 0
}

/**
 * Placement matrix for a chamfer prefab (local space: x=u, y=v, z=outward extent, centered on the
 * origin with z=+0.5 flush against the construction plane — see chamferGeometry.ts). Uses the cell's
 * own baked planeAxis/planeOrientation — never the currently active plane.
 *
 * Always returns a **proper rotation** (det=+1). On planes where the raw basis would be a reflection
 * (see chamferBasisIsReflected), it negates worldV *and* the baked rotation and expects the caller
 * to use the v-mirrored geometry variant: `makeBasis(U,V,W)·Rz(θ) = makeBasis(U,-V,W)·Rz(-θ)·F_v`,
 * where `F_v` (mirror in v) is baked into that geometry. Same placement, correct lighting.
 */
export function chamferInstanceMatrix(
  coord: Coord,
  planeAxis: Axis,
  planeOrientation: Orientation,
  rotation: 0 | 1 | 2 | 3,
  out = new THREE.Matrix4(),
): THREE.Matrix4 {
  const { worldU, worldV } = PLANE_BASIS[planeAxis]
  setFromCoord(scratchOutward, outwardNormal(planeAxis, planeOrientation))

  const sign = chamferBasisIsReflected(planeAxis, planeOrientation) ? -1 : 1
  scratchV.copy(worldV).multiplyScalar(sign)
  scratchBasis.makeBasis(worldU, scratchV, scratchOutward)

  // The centered model's origin is the cell's own 3D center (coord's min corner + 0.5 on each axis);
  // local z=+0.5 then lands exactly on the flush face, z=-0.5 on the inward base.
  scratchBasis.setPosition(coord[0] + 0.5, coord[1] + 0.5, coord[2] + 0.5)

  // Model is centered, so the baked rotation is a plain rotation about its own up axis (negated in
  // lockstep with worldV on reflected planes to keep placement identical — see the doc comment).
  scratchRotZ.makeRotationZ((sign * rotation * Math.PI) / 2)
  return out.copy(scratchBasis).multiply(scratchRotZ)
}
