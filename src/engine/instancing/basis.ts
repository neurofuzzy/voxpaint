import * as THREE from 'three'
import type { Axis, Coord, Orientation } from '@/engine/grid/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { ALL_AXES, flushFaceCoord, outwardNormal } from '@/engine/plane/planeGeometry'

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
const scratchCentered = new THREE.Matrix4()
const scratchRotZ = new THREE.Matrix4()
const scratchTranslate = new THREE.Matrix4()
const scratchOutward = new THREE.Vector3()
const scratchOrigin = new THREE.Vector3()

/** Placement matrix for a plain cube: axis-aligned, no plane basis needed. */
export function cubeInstanceMatrix(coord: Coord, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.makeTranslation(coord[0], coord[1], coord[2])
}

/**
 * Placement matrix for a chamfer prefab (local space: x=u, y=v, z=outward extent, z=1 flush with
 * the construction plane — see chamferGeometry.ts). Uses the cell's own baked
 * planeAxis/planeOrientation — never the currently active plane.
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
  scratchBasis.makeBasis(worldU, worldV, scratchOutward)

  // Local z=1 (the prefab's flush face) must land on the cell's actual flush face
  // (flushFaceCoord); the instance origin is local z=0, one unit further in along the outward
  // normal, so back off by scratchOutward from the flush face to place it. Same "flush face"
  // primitive ConstructionPlaneVisual.tsx and VoxelFaceHighlight.tsx use.
  setFromCoord(scratchOrigin, flushFaceCoord(coord, planeAxis, planeOrientation)).sub(scratchOutward)
  scratchBasis.setPosition(scratchOrigin)

  // Pre/post translate so the baked rotation happens about the footprint's center (0.5, 0.5), not the origin.
  scratchRotZ.makeRotationZ((rotation * Math.PI) / 2)
  scratchCentered.makeTranslation(0.5, 0.5, 0).multiply(scratchRotZ)
  scratchTranslate.makeTranslation(-0.5, -0.5, 0)
  scratchCentered.multiply(scratchTranslate)

  return out.copy(scratchBasis).multiply(scratchCentered)
}
