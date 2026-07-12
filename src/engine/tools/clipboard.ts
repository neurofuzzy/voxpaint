import type { ChamferCell, VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { forEachSelectedCell } from './selectionMask'
import type { ClipboardCell, ClipboardData, SelectionRegion } from '@/store/types'

/** Deep-copy a chamfer cell so the clipboard never shares references with the live model. */
function cloneChamfer(c: ChamferCell): ChamferCell {
  return { planeAxis: c.planeAxis, planeOrientation: c.planeOrientation, resolvedTo: c.resolvedTo ? { ...c.resolvedTo } : null }
}

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
      chamfer: chamfer ? cloneChamfer(chamfer) : undefined,
    })
  })
  return { width: region.width, height: region.height, originU: region.originU, originV: region.originV, cells }
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
 * Stamps clipboard data at a destination origin. Chamfer cells are restored **verbatim** — their
 * copied plane basis and resolved shape are written back unchanged, with no reclassification against
 * the destination's neighbors, so the pasted result exactly matches the source. (A chamfer only ever
 * (re)resolves when the user edits that specific voxel.) Mutates the given (draft) model directly.
 */
export function applyClipboardAt(
  model: VoxelModel,
  plane: ConstructionPlane,
  clipboard: ClipboardData,
  destOriginU: number,
  destOriginV: number,
): void {
  for (const cell of clipboard.cells) {
    const coord = gridCoordFromPixel(plane, destOriginU + cell.du, destOriginV + cell.dv)
    if (!withinWorkingBounds(coord)) continue

    const key = encodeKey(...coord)

    if (cell.chamfer) model.chamfer.set(key, cloneChamfer(cell.chamfer))
    else model.chamfer.delete(key)

    if (cell.color) {
      model.color.set(key, { paletteSlot: cell.color.paletteSlot })
      model.bounds = expandBounds(model.bounds, coord)
    }
  }
}
