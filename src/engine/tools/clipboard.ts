import type { VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { classify, resolveChamferCellsOnPlane, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { forEachSelectedCell } from './selectionMask'
import type { ClipboardCell, ClipboardData, SelectionRegion } from '@/store/types'

export function copyRegionToClipboard(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion): ClipboardData {
  const cells: ClipboardCell[] = []
  forEachSelectedCell(region, (u, v) => {
    const key = encodeKey(...gridCoordFromPixel(plane, u, v))
    const color = model.color.get(key)
    const chamfer = model.chamfer.get(key)
    if (!color && !chamfer) return
    cells.push({
      du: u - region.originU,
      dv: v - region.originV,
      color: color ? { paletteSlot: color.paletteSlot } : undefined,
      chamfer: chamfer ? true : undefined,
    })
  })
  return { width: region.width, height: region.height, cells }
}

/** Erases both layers under a selection mask (used by cut/move). Mutates the given (draft) model. */
export function clearRegion(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion): void {
  forEachSelectedCell(region, (u, v) => {
    const key = encodeKey(...gridCoordFromPixel(plane, u, v))
    model.color.delete(key)
    model.chamfer.delete(key)
  })
}

/**
 * Stamps clipboard data at a destination origin. Chamfer cells always paste (never dropped) —
 * each gets classified fresh against the destination's neighbors, same as a live chamfer paint;
 * `resolvedTo` is null if that doesn't (yet) resolve to a shape. A final `resolveChamferCellsOnPlane`
 * pass catches any cell whose required neighbor was pasted *later* in this same clipboard (paste
 * order within one operation shouldn't matter for whether a loop shape fully resolves).
 * Mutates the given (draft) model directly.
 */
export function applyClipboardAt(
  model: VoxelModel,
  plane: ConstructionPlane,
  clipboard: ClipboardData,
  destOriginU: number,
  destOriginV: number,
): void {
  for (const cell of clipboard.cells) {
    const u = destOriginU + cell.du
    const v = destOriginV + cell.dv
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord)) continue

    const key = encodeKey(...coord)

    if (cell.chamfer) {
      const resolvedTo = classify(sampleNeighbors(model, plane, u, v))
      model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo })
    } else {
      model.chamfer.delete(key)
    }

    if (cell.color) {
      model.color.set(key, { paletteSlot: cell.color.paletteSlot })
      model.bounds = expandBounds(model.bounds, coord)
    }
  }

  resolveChamferCellsOnPlane(model, plane)
}
