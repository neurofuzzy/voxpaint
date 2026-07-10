import type { Axis, Coord } from '@/engine/grid/types'
import type { ConstructionPlane } from './types'

/**
 * Fixed cyclic (u,v) basis per axis (x -> y,z ; y -> z,x ; z -> x,y).
 * Chosen once so all three axes share the same handedness rule with no special-casing.
 */
export function gridCoordFromPixel(plane: ConstructionPlane, u: number, v: number): Coord {
  switch (plane.axis) {
    case 'x':
      return [plane.offset, u, v]
    case 'y':
      return [v, plane.offset, u]
    case 'z':
      return [u, v, plane.offset]
  }
}

export function pixelFromGridCoord(plane: ConstructionPlane, coord: Coord): { u: number; v: number } {
  switch (plane.axis) {
    case 'x':
      return { u: coord[1], v: coord[2] }
    case 'y':
      return { u: coord[2], v: coord[0] }
    case 'z':
      return { u: coord[0], v: coord[1] }
  }
}

/**
 * Orientation never changes which grid cell a pixel maps to — it only flips the on-screen
 * u axis (display-only) so painting always feels like looking at the slab from outside,
 * and it flips which way chamfer geometry ramps "outward". Use this for canvas display only.
 */
export function toDisplayU(plane: ConstructionPlane, u: number): number {
  return plane.orientation === -1 ? -u : u
}

const AXES: Axis[] = ['x', 'y', 'z']

/**
 * Derives a construction plane from a 3D face-click: axis + orientation come from the
 * (cardinal-snapped) face normal, offset = the clicked cell's own coordinate along that axis
 * (spec §2.3 / §1.2 — you land on the slice the clicked cell lives on).
 */
export function planeFromFaceHit(cellCoord: Coord, worldNormal: Coord): ConstructionPlane {
  let axis: Axis = 'x'
  let maxAbs = -Infinity
  AXES.forEach((a, i) => {
    const abs = Math.abs(worldNormal[i])
    if (abs > maxAbs) {
      maxAbs = abs
      axis = a
    }
  })
  const axisIndex = AXES.indexOf(axis)
  const orientation = worldNormal[axisIndex] >= 0 ? 1 : -1
  return { axis, orientation, offset: cellCoord[axisIndex] }
}
