import type { Axis, Coord } from '@/engine/grid/types'
import type { ConstructionPlane } from './types'

/**
 * Cyclic (u,v) basis per axis (x -> z,-y ; y -> z,x ; z -> x,-y), fixed so all three axes share
 * the same handedness rule with no special-casing. Whenever world-Y is one of the two in-plane
 * axes (true for the x- and z-axis planes), it's always assigned to v and negated: the 2D editor
 * always treats v as increasing *downward* on screen (standard canvas convention), while three.js
 * world-Y increases *upward* — without this flip, content painted lower on the 2D canvas would
 * render higher in the 3D view (and vice versa). The y-axis plane has no in-plane Y at all (it
 * *is* the offset axis there), so it's unaffected.
 *
 * The flip is `-v - 1`, not bare `-v`: cells are corner-anchored (cell n spans world [n, n+1)),
 * so mirroring a corner index needs the -1 correction (mirroring continuous range [v, v+1) about
 * 0 lands on (-v-1, -v], i.e. cell index -v-1) — a bare `-v` silently shifts every cell one unit
 * up in world-Y.
 */
export function gridCoordFromPixel(plane: ConstructionPlane, u: number, v: number): Coord {
  switch (plane.axis) {
    case 'x':
      return [plane.offset, -v - 1, u]
    case 'y':
      return [v, plane.offset, u]
    case 'z':
      return [u, -v - 1, plane.offset]
  }
}

export function pixelFromGridCoord(plane: ConstructionPlane, coord: Coord): { u: number; v: number } {
  switch (plane.axis) {
    case 'x':
      return { u: coord[2], v: -coord[1] - 1 }
    case 'y':
      return { u: coord[2], v: coord[0] }
    case 'z':
      return { u: coord[0], v: -coord[1] - 1 }
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
