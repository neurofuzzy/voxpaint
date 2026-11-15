import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { cloneSubdiv } from '@/engine/grid/subdiv'
import { writeBox } from '@/engine/grid/cellBox'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { fineCellBox, forEachFineCell } from '@/engine/tools/fineSelection'
import { forEachSelectedCell } from '@/engine/tools/selectionMask'
import type { SelectionRegion } from '@/store/types'

/**
 * Writes at sub-voxel resolution: the model-side half of the fine selection. Every selected fine
 * cell is one `writeBox` (which splits just far enough, re-splits finer subdivisions, and folds
 * the result back to whole voxels where it can). Chamfer cells are atomic: any selected part of
 * one edits all of it.
 */
export type FineEdit = { kind: 'clear' } | { kind: 'paint'; slot: PaletteSlotRef }

/** Applies `edit` to exactly the fine cells a (possibly sub-voxel) region selects, on `plane`'s slice. */
export function editFineRegion(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion, edit: FineEdit): void {
  const atomicDone = new Set<string>()
  forEachFineCell(region, (fu, fv) => {
    const { coord, box } = fineCellBox(plane, region, fu, fv)
    const key = encodeKey(...coord)
    if (model.chamfer.has(key)) {
      // Whole chamfer cell: delete it, or recolor it in place (it keeps its shape).
      if (atomicDone.has(key)) return
      atomicDone.add(key)
      if (edit.kind === 'clear') {
        model.color.delete(key)
        model.chamfer.delete(key)
      } else {
        model.color.set(key, { paletteSlot: edit.slot })
      }
      return
    }
    writeBox(model, coord, box, edit.kind === 'clear' ? null : { slot: edit.slot })
  })
}

export function clearFineRegion(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion): void {
  editFineRegion(model, plane, region, { kind: 'clear' })
}

export function paintFineRegion(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion, slot: PaletteSlotRef): void {
  editFineRegion(model, plane, region, { kind: 'paint', slot })
}

/**
 * A scratch model holding ONLY the selected parts of the voxels a fine region touches (coordinates
 * unchanged) — what a copy of the selection contains. Unselected fine cells and the other slab are
 * cleared out of the copies; chamfer cells are atomic, so a touched one comes through whole.
 */
export function extractFineRegion(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion): VoxelModel {
  const f = region.fine
  const scratch = emptyModel()
  const coverage: SelectionRegion = { originU: region.originU, originV: region.originV, width: region.width, height: region.height, mask: region.mask }
  forEachSelectedCell(coverage, (u, v) => {
    const key = encodeKey(...gridCoordFromPixel(plane, u, v))
    const color = model.color.get(key)
    const chamfer = model.chamfer.get(key)
    const subdiv = model.subdiv.get(key)
    if (color) scratch.color.set(key, { paletteSlot: color.paletteSlot })
    if (chamfer) scratch.chamfer.set(key, { planeAxis: chamfer.planeAxis, planeOrientation: chamfer.planeOrientation, resolvedTo: chamfer.resolvedTo ? { ...chamfer.resolvedTo } : null })
    if (subdiv) scratch.subdiv.set(key, cloneSubdiv(subdiv))
  })
  if (!f) return scratch
  const fw = region.width * f.su
  const fh = region.height * f.sv
  const comp = new Uint8Array(fw * fh)
  const compCover = new Uint8Array(region.width * region.height)
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (f.mask[y * fw + x] === 1) continue
      comp[y * fw + x] = 1
      compCover[Math.floor(y / f.sv) * region.width + Math.floor(x / f.su)] = 1
    }
  }
  editFineRegion(scratch, plane, { ...coverage, mask: compCover, fine: { su: f.su, sv: f.sv, slab: f.slab, mask: comp } }, { kind: 'clear' })
  if (f.slab !== null) {
    // The other slab is not part of the selection either.
    const all = new Uint8Array(fw * fh).fill(1)
    editFineRegion(scratch, plane, { ...coverage, fine: { su: f.su, sv: f.sv, slab: (1 - f.slab) as 0 | 1, mask: all } }, { kind: 'clear' })
  }
  // Atomic chamfer cells came through whole (the clears above delete them): put them back.
  forEachSelectedCell(coverage, (u, v) => {
    const key = encodeKey(...gridCoordFromPixel(plane, u, v))
    const chamfer = model.chamfer.get(key)
    const color = model.color.get(key)
    if (chamfer && color) {
      scratch.color.set(key, { paletteSlot: color.paletteSlot })
      scratch.chamfer.set(key, { planeAxis: chamfer.planeAxis, planeOrientation: chamfer.planeOrientation, resolvedTo: chamfer.resolvedTo ? { ...chamfer.resolvedTo } : null })
    }
  })
  return scratch
}
