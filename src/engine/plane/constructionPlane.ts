import type { Axis, Coord } from '@/engine/grid/types'
import type { ConstructionPlane } from './types'

/**
 * Cyclic (u,v) basis per axis (x -> -z,-y ; y -> -x,z ; z -> x,-y). Whenever world-Y is one of the
 * two in-plane axes (true for the x- and z-axis planes), it's always assigned to v and negated:
 * the 2D editor always treats v as increasing *downward* on screen (standard canvas convention),
 * while three.js world-Y increases *upward* — without this flip, content painted lower on the 2D
 * canvas would render higher in the 3D view (and vice versa). The y-axis plane has no in-plane Y
 * at all (it *is* the offset axis there), so this particular flip doesn't apply to it — but per
 * below, it still needs its own u/v assignment chosen to match the other two axes' handedness.
 *
 * The x-axis case also negates u (u -> -z, not +z): a naive cyclic assignment (u -> +z, matching
 * z-axis's u -> +x) looks symmetric but actually has *opposite* handedness from the z-axis case,
 * because u borrows from a different pair of world axes on each (x vs z) — so without this extra
 * negation, east/west-facing planes render as a mirror image of the model (x/y/z all correct
 * individually, but u increasing the "wrong" way relative to what north/south planes do).
 *
 * The y-axis case is u -> -x, v -> z. Unlike x/z (which relate to each other by a yaw around
 * world-Y — a 180 degree spin that flips exactly one in-plane axis, handled below by
 * `toDisplayU`), the y-axis's two orientations (top vs bottom) relate by flipping *which side of
 * a horizontal sheet you view from* — empirically (see git history for this fix) that leaves u
 * constant across both orientations (hence the fixed `-x`, not a `toDisplayU`-driven flip) while
 * v is the one that needs to flip between them (`toDisplayV`, below, mirrored around orientation
 * +1 instead of -1).
 *
 * The flip is `-v - 1` (and, for x, `-u - 1`), not bare `-v`/`-u`: cells are corner-anchored (cell
 * n spans world [n, n+1)), so mirroring a corner index needs the -1 correction (mirroring
 * continuous range [v, v+1) about 0 lands on (-v-1, -v], i.e. cell index -v-1) — a bare `-v`
 * silently shifts every cell one unit up in world-Y (or, for u, one unit off in world-Z).
 */
export function gridCoordFromPixel(plane: ConstructionPlane, u: number, v: number): Coord {
  switch (plane.axis) {
    case 'x':
      return [plane.offset, -v - 1, -u - 1]
    case 'y':
      return [-u - 1, plane.offset, v]
    case 'z':
      return [u, -v - 1, plane.offset]
  }
}

export function pixelFromGridCoord(plane: ConstructionPlane, coord: Coord): { u: number; v: number } {
  switch (plane.axis) {
    case 'x':
      return { u: -coord[2] - 1, v: -coord[1] - 1 }
    case 'y':
      return { u: -coord[0] - 1, v: coord[2] }
    case 'z':
      return { u: coord[0], v: -coord[1] - 1 }
  }
}

/**
 * Orientation never changes which grid cell a pixel maps to — it only flips the on-screen
 * u axis (display-only) so painting always feels like looking at the slab from outside,
 * and it flips which way chamfer geometry ramps "outward". Use this for canvas display only.
 *
 * Same corner-index correction as gridCoordFromPixel's `-v - 1`: cell `u` is corner-anchored
 * (spans [u, u+1)), so mirroring it needs `-u - 1`, not bare `-u` — and that makes this function
 * involutory (`toDisplayU(toDisplayU(u)) === u`), so it's also its own inverse: this same
 * function converts a *displayed* u back to the logical/model u (see usePixelCanvasTools.ts's
 * `pixelToCell`).
 *
 * The y-axis plane is exempt (identity, regardless of orientation) — its u is already a fixed
 * `-x` (see gridCoordFromPixel above) and doesn't additionally flip with orientation; `toDisplayV`
 * carries the orientation-dependent flip for that axis instead.
 */
export function toDisplayU(plane: ConstructionPlane, u: number): number {
  if (plane.axis === 'y') return u
  return plane.orientation === -1 ? -u - 1 : u
}

/**
 * The y-axis counterpart to `toDisplayU` — see the comment there and on `gridCoordFromPixel`.
 * Identity for x/z-axis planes (their v never flips with orientation); for the y-axis plane, flips
 * (with the same corner-index `-v - 1` correction) when orientation is `1`, not `-1` — the mirror
 * image of `toDisplayU`'s trigger condition, since the top/bottom relationship isn't the same kind
 * of flip as north/south or east/west's. Involutory, so also its own inverse (`pixelToCell`).
 */
export function toDisplayV(plane: ConstructionPlane, v: number): number {
  if (plane.axis !== 'y') return v
  return plane.orientation === 1 ? -v - 1 : v
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
