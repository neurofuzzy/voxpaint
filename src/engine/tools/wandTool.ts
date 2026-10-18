import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import type { CellKey, Coord, GridExtent, VoxelModel } from '@/engine/grid/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { floodFillOccupied3D, floodFillRegion3D } from '@/engine/tools/floodFill'
import type { SelectionRegion } from '@/store/types'
import type { ToolHandler } from './types'

export type WandSelection = { region: SelectionRegion; anchor: Coord }

/** Max gap between two wand clicks for the second to expand (occupied) instead of restart (color). */
export const WAND_DOUBLE_TAP_MS = 1000

export type WandMatch = 'color' | 'occupied'

/**
 * Magic-wand selection: 6-connected flood from an occupied cell, reduced to its bounding-box
 * footprint on the given plane (mask covering exactly the flooded cells), plus the anchor cell.
 * - 'color': classic wand — only voxels sharing the start cell's palette slot.
 * - 'occupied': the whole touching component regardless of color.
 * The region gives plain selection semantics (copy/float/transform/highlight); component-scoped
 * ops (Delete) re-flood live from the anchor instead of trusting a stored set, so the component
 * can never go stale. Returns null when the start cell is empty (callers clear the selection).
 */
export function wandSelectionForComponent(
  model: VoxelModel,
  plane: ConstructionPlane,
  start: Coord,
  gridExtent: GridExtent,
  match: WandMatch,
): WandSelection | null {
  if (!model.color.has(encodeKey(...start))) return null
  const keys = match === 'color'
    ? floodFillRegion3D(model, start, gridExtent)
    : floodFillOccupied3D(model, start, gridExtent)
  if (keys.length === 0) return null
  return { region: regionForFloodedCells(plane, keys), anchor: start }
}

/**
 * Bounding-box footprint (full extent, mask covering exactly the given cells) of an already
 * flooded key set on a plane. Split out so callers that flooded for another reason (e.g. the
 * double-tap connectivity check) can reuse the flood instead of running it twice.
 */
export function regionForFloodedCells(plane: ConstructionPlane, keys: CellKey[]): SelectionRegion {
  // Bounding box over the flooded cells' plane projection…
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  const cells: Array<[number, number]> = []
  for (const key of keys) {
    const { u, v } = pixelFromGridCoord(plane, decodeKey(key))
    cells.push([u, v])
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
  }
  // …but the mask covers ONLY flooded cells: a full bbox rect would also catch other colors
  // (or empties-turned-voxels) sharing the box, and every downstream consumer (highlight,
  // slice delete, copy) would treat them as selected.
  const width = maxU - minU + 1
  const height = maxV - minV + 1
  const mask = new Uint8Array(width * height)
  for (const [u, v] of cells) mask[(v - minV) * width + (u - minU)] = 1
  return { originU: minU, originV: minV, width, height, mask }
}

/**
 * Wand tool (2D pointer half): tap-only, like the eyedropper. Delegates to the store's
 * `applyWandAt` (first tap: color-connected; re-tap within `WAND_DOUBLE_TAP_MS`: whole
 * component). The wand stays active — no tool handoff — so the second tap lands here too.
 * Drags are ignored — a wand click is atomic, never a gesture.
 */
export const wandTool: ToolHandler = {
  onDown(ctx, e) {
    ctx.applyWandAt(gridCoordFromPixel(ctx.plane, e.u, e.v))
  },
}
