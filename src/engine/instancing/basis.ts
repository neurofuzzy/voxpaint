import * as THREE from 'three'
import type { Axis, Coord, Orientation } from '@/engine/grid/types'

const AXIS_UNIT: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
}

// Mirrors the cyclic (u,v) basis in engine/plane/constructionPlane.ts (v is negated wherever it
// maps to world-Y, since the 2D editor's v increases downward but three.js's Y increases upward;
// u is also negated for the x-axis case, since a naive +z assignment has the opposite handedness
// from the z-axis case's u->+x — see the comment on constructionPlane.ts's gridCoordFromPixel).
// The y-axis case is u->x direct, v->-z — like x/z, this table reflects the orientation-independent
// *base* (logical) mapping only; toDisplayU/toDisplayV's orientation-dependent flip is a display-only
// concern that chamfer placement (baked from logical u/v at paint time) doesn't need to mirror here.
const WORLD_U: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(0, 0, -1),
  y: new THREE.Vector3(1, 0, 0),
  z: new THREE.Vector3(1, 0, 0),
}
const WORLD_V: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(0, -1, 0),
  y: new THREE.Vector3(0, 0, -1),
  z: new THREE.Vector3(0, -1, 0),
}

const scratchBasis = new THREE.Matrix4()
const scratchCentered = new THREE.Matrix4()
const scratchRotZ = new THREE.Matrix4()
const scratchTranslate = new THREE.Matrix4()

/** Placement matrix for a plain cube: axis-aligned, no plane basis needed. */
export function cubeInstanceMatrix(coord: Coord, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.makeTranslation(coord[0], coord[1], coord[2])
}

/**
 * Placement matrix for a chamfer prefab (local space: x=u, y=v, z=outward extent).
 * Uses the cell's own baked planeAxis/planeOrientation — never the currently active plane.
 */
export function chamferInstanceMatrix(
  coord: Coord,
  planeAxis: Axis,
  planeOrientation: Orientation,
  rotation: 0 | 1 | 2 | 3,
  out = new THREE.Matrix4(),
): THREE.Matrix4 {
  const axisUnit = AXIS_UNIT[planeAxis]
  const worldU = WORLD_U[planeAxis]
  const worldV = WORLD_V[planeAxis]
  const zColumn = planeOrientation === 1 ? axisUnit : axisUnit.clone().negate()

  scratchBasis.makeBasis(worldU, worldV, zColumn)
  const tx = coord[0] + (planeOrientation === -1 ? axisUnit.x : 0)
  const ty = coord[1] + (planeOrientation === -1 ? axisUnit.y : 0)
  const tz = coord[2] + (planeOrientation === -1 ? axisUnit.z : 0)
  scratchBasis.setPosition(tx, ty, tz)

  // Pre/post translate so the baked rotation happens about the footprint's center (0.5, 0.5), not the origin.
  scratchRotZ.makeRotationZ((rotation * Math.PI) / 2)
  scratchCentered.makeTranslation(0.5, 0.5, 0).multiply(scratchRotZ)
  scratchTranslate.makeTranslation(-0.5, -0.5, 0)
  scratchCentered.multiply(scratchTranslate)

  return out.copy(scratchBasis).multiply(scratchCentered)
}
