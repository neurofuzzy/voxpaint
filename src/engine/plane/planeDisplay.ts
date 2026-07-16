import type { ConstructionPlane } from './types'
import type { Coord } from '@/engine/grid/types'
import { pixelFromGridCoord } from './constructionPlane'
import { axisIndex } from './planeGeometry'

/**
 * Display-only (2D canvas) transforms — orientation-dependent screen mirroring layered on top of
 * the canonical, orientation-independent u/v <-> Coord mapping in constructionPlane.ts. Only
 * editor2d/ code should ever import from this file; 3D code has no reason to know about it.
 */

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
 * The y-axis plane is exempt (identity, regardless of orientation) — confirmed empirically that
 * its u doesn't flip between top and bottom; `toDisplayV` (below) carries the orientation-dependent
 * flip for that axis instead.
 */
export function toDisplayU(plane: ConstructionPlane, u: number): number {
  if (plane.axis === 'y') return u
  return plane.orientation === -1 ? -u - 1 : u
}

/**
 * The y-axis counterpart to `toDisplayU` — see the comment there and on `gridCoordFromPixel`.
 * Identity for x/z-axis planes (their v never flips with orientation); for the y-axis plane, flips
 * (same `-v - 1` correction) at orientation `1`, not `-1` — the opposite trigger from `toDisplayU`'s
 * x/z case, determined empirically rather than by symmetry. Involutory, so also its own inverse
 * (`pixelToCell`).
 */
export function toDisplayV(plane: ConstructionPlane, v: number): number {
  if (plane.axis !== 'y') return v
  return plane.orientation === 1 ? -v - 1 : v
}

/**
 * The continuous display-space (u, v) coordinate the 2D canvas should frame at its centre for
 * `plane`, so a project reads centred on every plane/orientation. For an EVEN project this is the
 * world-origin gridline (0, 0) — the true grid centre. For an ODD project the model is still the
 * even `effectiveExtent` grid, but we want its centre *pillar* (the model in-plane origin cell)
 * dead-centre; because the 2D canvas draws in display space (post-`toDisplay` mirror), the pillar's
 * display cell — and hence the half-cell nudge that centres it — flips with orientation, so we
 * compute it here rather than applying a fixed pan. Returns the pillar cell's centre (its display
 * index + 0.5). See PixelCanvas.tsx / usePixelCanvasTools.ts.
 */
export function displayViewCenter(plane: ConstructionPlane, gridExtent: number): { u: number; v: number } {
  if (gridExtent % 2 === 0) return { u: 0, v: 0 }
  const pillar: Coord = [0, 0, 0]
  pillar[axisIndex(plane.axis)] = plane.offset // in-plane pixel is offset-independent; kept for clarity
  const { u, v } = pixelFromGridCoord(plane, pillar)
  return { u: toDisplayU(plane, u) + 0.5, v: toDisplayV(plane, v) + 0.5 }
}
