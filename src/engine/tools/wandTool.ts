import { decodeKey } from '@/engine/grid/GridStore'
import type { CellKey, Coord } from '@/engine/grid/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { SelectionRegion } from '@/store/types'
import type { ToolHandler } from './types'

/** Max gap between two wand clicks for the second to expand (occupied) instead of restart (color). */
export const WAND_DOUBLE_TAP_MS = 1000

/**
 * Bounding-box footprint (full extent, mask covering exactly the given cells) of an already
 * flooded key set on a plane. Used for the split-layout wand path (the 2D footprint region);
 * the 3D-only path stores the key set itself. Null when no flooded cell lies on the plane's
 * own slice (e.g. a 3D tap on an off-slice voxel) — callers clear the selection instead of
 * storing a zero-size region.
 *
 * Only flooded cells lying on the plane's own slice land in the mask: a full-volume flood
 * projected flat would also select unrelated voxels sharing the off-slice cells' (u,v), and
 * every downstream consumer (highlight, slice delete, copy) would treat them as selected.
 */
export function regionForFloodedCells(plane: ConstructionPlane, keys: CellKey[]): SelectionRegion | null {
  // Bounding box over the on-slice flooded cells' plane projection…
  const ai = axisIndex(plane.axis)
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  const cells: Array<[number, number]> = []
  for (const key of keys) {
    const coord: Coord = decodeKey(key)
    if (coord[ai] !== plane.offset) continue
    const { u, v } = pixelFromGridCoord(plane, coord)
    cells.push([u, v])
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
  }
  if (cells.length === 0) return null
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
