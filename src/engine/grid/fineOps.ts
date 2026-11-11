import { emptyModel, expandBounds, encodeKey } from '@/engine/grid/GridStore'
import type { Coord, SplitAxis, VoxelModel } from '@/engine/grid/types'
import {
  cloneSubdiv, normalizeSplit, remapChildren, scaffoldCell, splitChildBits, subdivideCell,
} from '@/engine/grid/subdiv'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { gridCoordFromPixel, planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import { forEachFineCell, isFineSelected, worldAxisOf } from '@/engine/tools/fineSelection'
import { forEachSelectedCell } from '@/engine/tools/selectionMask'
import type { SelectionRegion } from '@/store/types'

/**
 * Writes at sub-voxel resolution: the model-side half of the fine selection. A voxel is edited
 * through its children — a plain cube is split just far enough (along only the axes the selection
 * actually cuts), an existing subdivision is re-split by volume overlap when the selection needs a
 * finer cut than it has, and a voxel the selection covers entirely is edited whole. Chamfer
 * cells are atomic: any selected part of one selects all of it.
 */
export type FineEdit = { kind: 'clear' } | { kind: 'paint'; slot: PaletteSlotRef }

const AXES: SplitAxis[] = ['x', 'y', 'z']

/** One voxel's selected fine cells: `sel[iu][iv]` over logical halves (1 entry on an uncut axis). */
type CellSel = boolean[][]

function editCell(
  model: VoxelModel,
  coord: Coord,
  sel: CellSel,
  slab: 0 | 1 | null,
  uAxis: SplitAxis,
  vAxis: SplitAxis,
  uPos: boolean,
  vPos: boolean,
  wAxis: SplitAxis,
  edit: FineEdit,
): void {
  const su = sel.length
  const sv = sel[0].length
  const any = sel.some((col) => col.some(Boolean))
  if (!any) return
  const all = sel.every((col) => col.every(Boolean)) && slab === null
  const key = encodeKey(...coord)
  const plain = model.color.has(key)
  const atomic = model.chamfer.has(key)

  if (all || atomic) {
    // Whole voxel: delete it, or recolor it in place (a chamfer keeps its shape).
    if (edit.kind === 'clear') {
      model.color.delete(key)
      model.chamfer.delete(key)
      model.subdiv.delete(key)
    } else if (atomic) {
      model.color.set(key, { paletteSlot: edit.slot })
    } else {
      const sub = model.subdiv.get(key)
      if (sub) {
        sub.children = sub.children.map(() => ({ slot: edit.slot }))
        sub.scaffold = false
      } else {
        model.color.set(key, { paletteSlot: edit.slot })
        model.bounds = expandBounds(model.bounds, coord)
      }
    }
    return
  }

  // Which axes does this selection cut through the voxel?
  const need = new Set<SplitAxis>()
  if (su === 2 && [0, 1].some((iv) => iv < sv && sel[0][iv] !== sel[1][iv])) need.add(uAxis)
  if (sv === 2 && [0, 1].some((iu) => iu < su && sel[iu][0] !== sel[iu][1])) need.add(vAxis)
  if (slab !== null) need.add(wAxis)

  let sub = model.subdiv.get(key)
  if (!sub) {
    if (!plain && edit.kind === 'clear') return // nothing there to clear
    const split = normalizeSplit([...need])
    if (!split) return
    if (plain) subdivideCell(model, coord, split)
    else if (!scaffoldCell(model, coord, split, (edit as { slot: PaletteSlotRef }).slot)) return
    sub = model.subdiv.get(key)!
  } else {
    const merged = normalizeSplit([...new Set<SplitAxis>([...sub.split, ...need])])
    if (merged && merged.join('') !== sub.split.join('')) {
      sub.children = remapChildren(sub.split, sub.children, merged)
      sub.split = merged
    }
  }

  sub.children.forEach((_, idx) => {
    const bits = splitChildBits(sub!.split, idx)
    const bit = { x: bits[0], y: bits[1], z: bits[2] }
    if (slab !== null && bit[wAxis] !== slab) return
    // The logical halves this child covers (both along an axis the voxel is not cut on).
    const ius = sub!.split.includes(uAxis) ? [uPos ? bit[uAxis] : 1 - bit[uAxis]] : [0, 1].slice(0, su)
    const ivs = sub!.split.includes(vAxis) ? [vPos ? bit[vAxis] : 1 - bit[vAxis]] : [0, 1].slice(0, sv)
    if (!ius.every((iu) => ivs.every((iv) => sel[Math.min(iu, su - 1)][Math.min(iv, sv - 1)]))) return
    sub!.children[idx] = edit.kind === 'clear' ? null : { slot: edit.slot }
  })

  if (edit.kind === 'paint') sub.scaffold = false
  if (sub.children.every((c) => c === null)) model.subdiv.delete(key)
  else {
    model.bounds = expandBounds(model.bounds, coord)
    tidyCell(model, key)
  }
}

/**
 * Folds a subdivision whose children are all the same plain slot back into one cube — a split that
 * no longer carries any detail is just bookkeeping (and costs a draw). Detail with holes, bevels or
 * differing slots is kept.
 */
export function tidyCell(model: VoxelModel, key: string): void {
  const sub = model.subdiv.get(key)
  if (!sub || sub.children.length === 0) return
  const first = sub.children[0]
  if (!first || first.chamfer) return
  const same = sub.children.every((c) => c && !c.chamfer && c.slot.kind === first.slot.kind && c.slot.index === first.slot.index)
  if (!same) return
  model.subdiv.delete(key)
  model.color.set(key, { paletteSlot: first.slot })
}

/** Applies `edit` to exactly the fine cells a (possibly sub-voxel) region selects, on `plane`'s slice. */
export function editFineRegion(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion, edit: FineEdit): void {
  const f = region.fine
  const su = f?.su ?? 1
  const sv = f?.sv ?? 1
  const slab = f?.slab ?? null
  const { uDir, vDir } = planeLogicalBasis(plane.axis)
  const uAxis = worldAxisOf(uDir)
  const vAxis = worldAxisOf(vDir)
  const wAxis = AXES[axisIndex(plane.axis)]
  const uPos = uDir[AXES.indexOf(uAxis)] > 0
  const vPos = vDir[AXES.indexOf(vAxis)] > 0

  // Group fine cells by their voxel.
  const cells = new Map<string, { u: number; v: number }>()
  forEachFineCell(region, (fu, fv) => {
    const u = Math.floor(fu / su)
    const v = Math.floor(fv / sv)
    cells.set(`${u},${v}`, { u, v })
  })
  for (const { u, v } of cells.values()) {
    const sel: CellSel = Array.from({ length: su }, (_, iu) =>
      Array.from({ length: sv }, (_, iv) => isFineSelected(region, u * su + iu, v * sv + iv)),
    )
    editCell(model, gridCoordFromPixel(plane, u, v), sel, slab, uAxis, vAxis, uPos, vPos, wAxis, edit)
  }
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
