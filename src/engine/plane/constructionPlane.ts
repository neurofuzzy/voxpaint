import type { Axis, Coord } from '@/engine/grid/types'
import type { ConstructionPlane } from './types'
import { ALL_AXES, axisIndex } from './planeGeometry'

/**
 * Cyclic (u,v) basis per axis (x -> -z,-y ; y -> x,-z ; z -> x,-y). Whenever world-Y is one of
 * the two in-plane axes (true for the x- and z-axis planes), it's always assigned to v and
 * negated: the 2D editor always treats v as increasing *downward* on screen (standard canvas
 * convention), while three.js world-Y increases *upward* — without this flip, content painted
 * lower on the 2D canvas would render higher in the 3D view (and vice versa). The y-axis plane has
 * no in-plane Y at all (it *is* the offset axis there), so this particular flip doesn't apply to
 * it, but its v (-> z) still gets a `-1`-style correction below, just like x/z's v (-> y) does.
 *
 * The x-axis case also negates u (u -> -z, not +z): a naive cyclic assignment (u -> +z, matching
 * z-axis's u -> +x) looks symmetric but actually has *opposite* handedness from the z-axis case,
 * because u borrows from a different pair of world axes on each (x vs z) — so without this extra
 * negation, east/west-facing planes render as a mirror image of the model (x/y/z all correct
 * individually, but u increasing the "wrong" way relative to what north/south planes do).
 *
 * The y-axis case is u -> x direct, with NO orientation-dependent flip ever (`toDisplayU` in
 * planeDisplay.ts is identity for this axis — confirmed empirically: top and bottom were found to
 * be wrong in u the *same* way, not mirrored relative to each other, so the fix is a plain
 * constant, not a `toDisplayU`-driven flip). Its v -> -z *does* still flip with orientation, like
 * x/z's u does, but the flip is carried by a separate `toDisplayV` (triggered at orientation `1`,
 * not `-1` — determined empirically, not by symmetry with x/z) rather than `toDisplayU`, since
 * it's v, not u, that's the axis varying with orientation on this plane.
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
      return [u, plane.offset, -v - 1]
    case 'z':
      return [u, -v - 1, plane.offset]
  }
}

export function pixelFromGridCoord(plane: ConstructionPlane, coord: Coord): { u: number; v: number } {
  switch (plane.axis) {
    case 'x':
      return { u: -coord[2] - 1, v: -coord[1] - 1 }
    case 'y':
      return { u: coord[0], v: -coord[2] - 1 }
    case 'z':
      return { u: coord[0], v: -coord[1] - 1 }
  }
}

/**
 * Derives the world-space direction of a plane's logical u and v axes by probing
 * gridCoordFromPixel at (1,0) and (0,1) vs (0,0) on a canonical orientation:1, offset:0 plane and
 * taking the componentwise difference — valid because gridCoordFromPixel is orientation- and
 * offset-independent in its u/v handling by construction (see its doc comment above). This is the
 * single source of truth 3D-side code (engine/instancing/basis.ts) derives its world-axis basis
 * from, so it can never drift out of sync with this function the way a hand-copied table could —
 * which is exactly what caused the mirrored/backwards-axis bugs this module exists to prevent.
 */
export function planeLogicalBasis(axis: Axis): { uDir: Coord; vDir: Coord } {
  const probe: ConstructionPlane = { axis, orientation: 1, offset: 0 }
  const origin = gridCoordFromPixel(probe, 0, 0)
  const uProbe = gridCoordFromPixel(probe, 1, 0)
  const vProbe = gridCoordFromPixel(probe, 0, 1)
  return {
    uDir: [uProbe[0] - origin[0], uProbe[1] - origin[1], uProbe[2] - origin[2]],
    vDir: [vProbe[0] - origin[0], vProbe[1] - origin[1], vProbe[2] - origin[2]],
  }
}

/**
 * Derives a construction plane from a 3D face-click: axis + orientation come from the
 * (cardinal-snapped) face normal, offset = the clicked cell's own coordinate along that axis
 * (spec §2.3 / §1.2 — you land on the slice the clicked cell lives on).
 */
export function planeFromFaceHit(cellCoord: Coord, worldNormal: Coord): ConstructionPlane {
  let axis: Axis = 'x'
  let maxAbs = -Infinity
  for (const a of ALL_AXES) {
    const abs = Math.abs(worldNormal[axisIndex(a)])
    if (abs > maxAbs) {
      maxAbs = abs
      axis = a
    }
  }
  const i = axisIndex(axis)
  const orientation = worldNormal[i] >= 0 ? 1 : -1
  return { axis, orientation, offset: cellCoord[i] }
}
