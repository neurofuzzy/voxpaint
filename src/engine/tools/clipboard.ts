import type { VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
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
      chamfer: chamfer ? { rotation: chamfer.rotation } : undefined,
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

export type PasteResult = { applied: number; droppedChamfer: number }

/**
 * Stamps clipboard data at a destination origin. Chamfer cells are re-validated against the
 * destination's neighbors (spec §2) — invalid ones are dropped but their color still applies.
 * Mutates the given (draft) model directly.
 */
export function applyClipboardAt(
  model: VoxelModel,
  plane: ConstructionPlane,
  clipboard: ClipboardData,
  destOriginU: number,
  destOriginV: number,
): PasteResult {
  let applied = 0
  let droppedChamfer = 0

  for (const cell of clipboard.cells) {
    const u = destOriginU + cell.du
    const v = destOriginV + cell.dv
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord)) continue

    const key = encodeKey(...coord)

    if (cell.chamfer) {
      const classification = classify(sampleNeighbors(model, plane, u, v))
      if (classification) {
        model.chamfer.set(key, {
          shapeKind: classification.shapeKind,
          rotation: classification.rotation,
          planeAxis: plane.axis,
          planeOrientation: plane.orientation,
        })
        if (cell.color) model.color.set(key, { paletteSlot: cell.color.paletteSlot })
        model.bounds = expandBounds(model.bounds, coord)
        applied++
        continue
      }
      droppedChamfer++
      model.chamfer.delete(key)
      // fall through — the cell's color still applies below
    } else {
      model.chamfer.delete(key)
    }

    if (cell.color) {
      model.color.set(key, { paletteSlot: cell.color.paletteSlot })
      model.bounds = expandBounds(model.bounds, coord)
      applied++
    }
  }

  return { applied, droppedChamfer }
}
