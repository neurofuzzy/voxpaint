import type { Axis, Coord, Orientation } from '@/engine/grid/types'

/** All three axes, in the fixed x/y/z order every index-based lookup below assumes. */
export const ALL_AXES: Axis[] = ['x', 'y', 'z']

/** The one canonical copy of each axis's unit vector. 3D consumers convert to THREE.Vector3 at
 * their own boundary (see components/viewport3d/axisVectors.ts). */
export const AXIS_UNIT: Record<Axis, Coord> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

export function axisIndex(axis: Axis): 0 | 1 | 2 {
  return ALL_AXES.indexOf(axis) as 0 | 1 | 2
}

/** The unit vector a construction plane's face points toward, given its orientation. */
export function outwardNormal(axis: Axis, orientation: Orientation): Coord {
  const [x, y, z] = AXIS_UNIT[axis]
  return orientation === 1 ? [x, y, z] : [-x, -y, -z]
}

/**
 * Cells are corner-anchored ([n, n+1) along every axis — see constructionPlane.ts's
 * gridCoordFromPixel doc comment). A plane's "flush" face — the boundary of its own offset layer
 * that it visually/logically sits against — is the far one (axisCoord+1) for orientation 1, the
 * near one (axisCoord) for orientation -1. This is the ONE place that rule is expressed; every
 * flush-face computation in the codebase (plane visual position, face-hover highlight, chamfer
 * placement) derives from this function or flushFaceCoord below instead of re-deriving it by eye.
 */
export function flushFaceValue(axisCoord: number, orientation: Orientation): number {
  return axisCoord + (orientation === 1 ? 1 : 0)
}

/** Full 3D position of `coord`'s flush face along `axis` (see flushFaceValue) — the other two
 * components pass through unchanged. */
export function flushFaceCoord(coord: Coord, axis: Axis, orientation: Orientation): Coord {
  const i = axisIndex(axis)
  const out: Coord = [coord[0], coord[1], coord[2]]
  out[i] = flushFaceValue(coord[i], orientation)
  return out
}
