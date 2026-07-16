import type { BBox, CellKey, ChamferCell, ColorCell, Coord, GridExtent, VoxelModel } from './types'

export function encodeKey(x: number, y: number, z: number): CellKey {
  return `${x},${y},${z}`
}

export function decodeKey(key: CellKey): Coord {
  const [x, y, z] = key.split(',').map(Number)
  return [x, y, z]
}

export function emptyModel(): VoxelModel {
  return { color: new Map(), chamfer: new Map(), bounds: null }
}

export function getColorCell(model: VoxelModel, coord: Coord): ColorCell | undefined {
  return model.color.get(encodeKey(...coord))
}

export function getChamferCell(model: VoxelModel, coord: Coord): ChamferCell | undefined {
  return model.chamfer.get(encodeKey(...coord))
}

export function expandBounds(bounds: BBox | null, coord: Coord): BBox {
  if (!bounds) return { min: coord, max: coord }
  return {
    min: [
      Math.min(bounds.min[0], coord[0]),
      Math.min(bounds.min[1], coord[1]),
      Math.min(bounds.min[2], coord[2]),
    ],
    max: [
      Math.max(bounds.max[0], coord[0]),
      Math.max(bounds.max[1], coord[1]),
      Math.max(bounds.max[2], coord[2]),
    ],
  }
}

/** Recomputes bounds from scratch by scanning both layers. Cheap relative to paint frequency; only needed after a removal that might have shrunk the box. */
export function recomputeBounds(model: VoxelModel): BBox | null {
  let bounds: BBox | null = null
  for (const key of model.color.keys()) bounds = expandBounds(bounds, decodeKey(key))
  for (const key of model.chamfer.keys()) bounds = expandBounds(bounds, decodeKey(key))
  return bounds
}

/** Absolute technical ceiling per spec §1.1 — never exceeded regardless of project size. Every
 * `GridExtent` preset stays comfortably under this. */
export const MAX_GRID_EXTENT = 64

/** Default working span used only before a project's own `meta.gridExtent` is known (initial store
 * state, pre-load). Matches the "Medium" preset. Once a project is loaded/created, always use its
 * own `meta.gridExtent` instead of this constant. */
export const DEFAULT_GRID_EXTENT: GridExtent = 16

/**
 * The even grid the engine actually works on. The whole coordinate system (the corner-anchored
 * `-v-1` mirror in constructionPlane.ts, instancing, chamfer, texture) is only self-consistent for
 * EVEN extents (ranges symmetric about -0.5). So an odd project size is rounded up by one here and
 * the engine treats it as that even grid — no odd number ever reaches the coordinate math. The one
 * extra column is real (paintable); the views frame it out via `viewOriginShift`. Even sizes are
 * returned unchanged. */
export function effectiveExtent(extent: GridExtent): number {
  return extent % 2 === 0 ? extent : extent + 1
}

/** Half-cell the 2D/3D views nudge their framing (pan, origin marker, camera target) so an odd
 * project's center column sits dead-centre despite the even effective grid: 0.5 for odd, 0 for even.
 * View-only — it never touches stored coordinates. */
export function viewOriginShift(extent: GridExtent): number {
  return extent % 2 === 0 ? 0 : 0.5
}

/** Absolute box centered on the origin (spec §1.1: "conceptually infinite, centered at the
 * origin") — not a sliding growth cap. A coord anywhere in the model must fall inside this box
 * regardless of where the model's other cells happen to be. `extent` is the project's own
 * `meta.gridExtent` — every caller must pass it explicitly rather than assuming a fixed size.
 * Bounds run over the even `effectiveExtent`, so an odd project can paint its full (even) volume. */
export function withinWorkingBounds(coord: Coord, extent: GridExtent): boolean {
  const half = effectiveExtent(extent) / 2
  return coord.every((c) => c >= -half && c < half)
}
