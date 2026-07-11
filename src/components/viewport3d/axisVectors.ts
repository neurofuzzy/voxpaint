import * as THREE from 'three'
import type { Axis, Coord } from '@/engine/grid/types'
import { AXIS_UNIT } from '@/engine/plane/planeGeometry'

/** Small Coord -> THREE.Vector3 boundary conversion, shared by the handful of 3D components that
 * need axis/orientation geometry as Vector3 rather than the plain Coord tuples engine/ uses
 * (engine/ stays THREE-free per repo convention — see CLAUDE.md). */
export function toVector3([x, y, z]: Coord): THREE.Vector3 {
  return new THREE.Vector3(x, y, z)
}

/** THREE.Vector3 view of planeGeometry.ts's AXIS_UNIT — the one canonical axis-unit-vector
 * source, converted once at module load. */
export const AXIS_UNIT_VECTOR: Record<Axis, THREE.Vector3> = {
  x: toVector3(AXIS_UNIT.x),
  y: toVector3(AXIS_UNIT.y),
  z: toVector3(AXIS_UNIT.z),
}

export const UP = new THREE.Vector3(0, 1, 0)
