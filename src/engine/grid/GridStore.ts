import type { BBox, CellKey, ChamferCell, ColorCell, Coord, VoxelModel } from './types'

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

/** Absolute technical ceiling per spec §1.1 — never exceeded regardless of project size. Reserved
 * for future per-project sizing via project options; not itself an enforced limit today. */
export const MAX_GRID_EXTENT = 64

/** Default working span for new projects — the actual enforced/displayed grid size until project
 * options add per-project sizing (up to MAX_GRID_EXTENT). */
export const DEFAULT_GRID_EXTENT = 16

/** Absolute box centered on the origin (spec §1.1: "conceptually infinite, centered at the
 * origin") — not a sliding growth cap. A coord anywhere in the model must fall inside this box
 * regardless of where the model's other cells happen to be. */
export function withinWorkingBounds(coord: Coord): boolean {
  const half = DEFAULT_GRID_EXTENT / 2
  return coord.every((c) => c >= -half && c < half)
}
