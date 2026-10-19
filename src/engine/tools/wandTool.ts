import { decodeKey } from '@/engine/grid/GridStore'
import type { CellKey } from '@/engine/grid/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { SelectionRegion } from '@/store/types'
import type { ToolHandler } from './types'

/** Max gap between two wand clicks for the second to expand (occupied) instead of restart (color). */
export const WAND_DOUBLE_TAP_MS = 1000

/**
 * Bounding-box footprint (full extent, mask covering exactly the given cells) of an already
 * flooded key set on a plane. Used for the split-layout wand path (the 2D footprint region);
 * the 3D-only path stores the key set itself.
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
