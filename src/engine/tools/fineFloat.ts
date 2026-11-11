import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord, DetailChild, GridExtent, SplitAxis, VoxelModel } from '@/engine/grid/types'
import {
  normalizeSplit, remapChildren, scaffoldCell, splitChildOrigin, splitChildSize, subdivideCell,
} from '@/engine/grid/subdiv'
import { clearFineRegion, tidyCell } from '@/engine/grid/fineOps'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { frontSlabBit } from '@/engine/grid/subdiv'
import { pixelFromGridCoord, planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { ClipboardCell, ClipboardData, SelectionRegion } from '@/store/types'
import { cloneChamfer, placeClipboardCell } from './clipboard'
import { worldAxisOf } from './fineSelection'

/**
 * Sub-voxel floats: content copied from a sub-voxel selection moves in fine (half-voxel) steps.
 * The clipboard cells hold only the selected parts as detail; the float is placed as PIECES — each
 * child (or plain cube) as a world box, shifted by the fine offset, cut at voxel boundaries, and
 * written into whatever target cell it lands in (splitting it just far enough). Dropping first
 * clears the float's fine footprint, so a drop replaces exactly what it covers.
 *
 * Detail children — plain or beveled — move freely: they are 0.5-aligned boxes, so a half-voxel
 * shift always lands them whole on the child grid and their frozen shapes survive the drop.
 * Whole chamfer CELLS are the exception: unit-scale frozen geometry with no half-voxel
 * representation (and the drop restores them verbatim, unshifted), so content holding one is
 * "atomic" and moves in whole voxels only (`fineFloatAtomic`, enforced where origins land).
 */

/** True when the content holds a whole chamfer cell — unit-scale frozen geometry that has no
 * half-voxel position, so the float moves in whole voxels only. Beveled detail children do NOT
 * count: they ride as 0.5-aligned pieces and land whole. */
export function fineFloatAtomic(clip: ClipboardData): boolean {
  return clip.cells.some((c) => !!c.chamfer)
}

export type FloatPiece = {
  /** The voxel the piece lies in. */
  cell: Coord
  /** Lower corner inside the voxel (each 0 or 0.5) and size (each 0.5 or 1). */
  origin: [number, number, number]
  size: [number, number, number]
  slot: PaletteSlotRef
  /**
   * Frozen shape of the source child, carried so beveled detail survives the drop. Only
   * restored when the piece covers its target child exactly (see `writePiece`) — a cut
   * chamfer is unrepresentable, so partial covers land as plain slots.
   */
  chamfer?: DetailChild['chamfer']
}

const EPS = 1e-6

/** World shift (grid units) of a fine offset on `plane`: along logical u / v. */
function worldShift(plane: ConstructionPlane, clip: ClipboardData, subU: number, subV: number): [number, number, number] {
  const f = clip.fine
  const out: [number, number, number] = [0, 0, 0]
  if (!f) return out
  const { uDir, vDir } = planeLogicalBasis(plane.axis)
  const uA = axisIndex(worldAxisOf(uDir))
  const vA = axisIndex(worldAxisOf(vDir))
  if (f.su === 2) out[uA] += (uDir[uA] > 0 ? 1 : -1) * 0.5 * subU
  if (f.sv === 2) out[vA] += (vDir[vA] > 0 ? 1 : -1) * 0.5 * subV
  return out
}

function cellPieces(cell: ClipboardCell): Array<{ origin: [number, number, number]; size: [number, number, number]; slot: PaletteSlotRef; chamfer?: DetailChild['chamfer'] }> {
  if (cell.subdiv) {
    const out = []
    const size = splitChildSize(cell.subdiv.split)
    for (let o = 0; o < cell.subdiv.children.length; o++) {
      const child = cell.subdiv.children[o]
      if (!child) continue
      out.push({ origin: splitChildOrigin([0, 0, 0], cell.subdiv.split, o), size, slot: child.slot, ...(child.chamfer ? { chamfer: cloneChamfer(child.chamfer) } : {}) })
    }
    return out
  }
  if (cell.color && !cell.chamfer) return [{ origin: [0, 0, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number], slot: cell.color.paletteSlot }]
  return []
}

/** Cuts [lo, hi) into per-voxel segments at integer boundaries. */
function segments(lo: number, hi: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let a = lo
  while (a < hi - EPS) {
    const next = Math.min(hi, Math.floor(a + EPS) + 1)
    out.push([a, next])
    a = next
  }
  return out
}

/** Every piece of a float placed at (originU, originV) + (subU, subV) fine units, cut to single voxels. */
export function floatPieces(
  plane: ConstructionPlane,
  clip: ClipboardData,
  originU: number,
  originV: number,
  subU: number,
  subV: number,
): FloatPiece[] {
  const shift = worldShift(plane, clip, subU, subV)
  const out: FloatPiece[] = []
  for (const cell of clip.cells) {
    const base = placeClipboardCell(plane, clip, originU, originV, cell)
    for (const piece of cellPieces(cell)) {
      const lo = [0, 1, 2].map((a) => base[a] + piece.origin[a] + shift[a])
      const hi = [0, 1, 2].map((a) => lo[a] + piece.size[a])
      for (const [x0, x1] of segments(lo[0], hi[0])) {
        for (const [y0, y1] of segments(lo[1], hi[1])) {
          for (const [z0, z1] of segments(lo[2], hi[2])) {
            const cellCoord: Coord = [Math.floor(x0 + EPS), Math.floor(y0 + EPS), Math.floor(z0 + EPS)]
            out.push({
              cell: cellCoord,
              origin: [x0 - cellCoord[0], y0 - cellCoord[1], z0 - cellCoord[2]],
              size: [x1 - x0, y1 - y0, z1 - z0],
              slot: piece.slot,
              // Voxel-boundary cuts never split a 0.5-aligned child, so a chamfered piece
              // still covers its whole child here; `writePiece` re-checks before restoring.
              ...(piece.chamfer ? { chamfer: piece.chamfer } : {}),
            })
          }
        }
      }
    }
  }
  return out
}

/** The fine footprint of a float as a region (for clearing the drop zone and for highlights). */
export function floatFootprintRegion(
  plane: ConstructionPlane,
  clip: ClipboardData,
  originU: number,
  originV: number,
  subU: number,
  subV: number,
): SelectionRegion | null {
  const f = clip.fine
  if (!f) return null
  const fw = clip.width * f.su
  const fu0 = originU * f.su + subU
  const fv0 = originV * f.sv + subV
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  const bits: Array<[number, number]> = []
  for (let i = 0; i < f.mask.length; i++) {
    if (f.mask[i] !== 1) continue
    const fu = fu0 + (i % fw)
    const fv = fv0 + Math.floor(i / fw)
    bits.push([fu, fv])
    minU = Math.min(minU, fu)
    maxU = Math.max(maxU, fu)
    minV = Math.min(minV, fv)
    maxV = Math.max(maxV, fv)
  }
  if (bits.length === 0) return null
  const ou = Math.floor(minU / f.su)
  const ov = Math.floor(minV / f.sv)
  const width = Math.floor(maxU / f.su) - ou + 1
  const height = Math.floor(maxV / f.sv) - ov + 1
  const mask = new Uint8Array(width * height)
  const fmask = new Uint8Array(width * f.su * height * f.sv)
  for (const [fu, fv] of bits) {
    fmask[(fv - ov * f.sv) * width * f.su + (fu - ou * f.su)] = 1
    mask[(Math.floor(fv / f.sv) - ov) * width + (Math.floor(fu / f.su) - ou)] = 1
  }
  const slab = f.slab === null ? null : ((plane.half ?? frontSlabBit(plane.orientation)) as 0 | 1)
  return { originU: ou, originV: ov, width, height, mask, fine: { su: f.su, sv: f.sv, slab, mask: fmask } }
}

function writePiece(model: VoxelModel, piece: FloatPiece): void {
  const key = encodeKey(...piece.cell)
  const need: SplitAxis[] = (['x', 'y', 'z'] as const).filter((_, a) => piece.size[a] < 1 - EPS)
  if (need.length === 0) {
    model.subdiv.delete(key)
    model.chamfer.delete(key)
    model.color.set(key, { paletteSlot: piece.slot })
    model.bounds = expandBounds(model.bounds, piece.cell)
    return
  }
  let sub = model.subdiv.get(key)
  if (!sub) {
    const split = normalizeSplit(need)!
    if (model.color.has(key)) subdivideCell(model, piece.cell, split)
    else scaffoldCell(model, piece.cell, split, piece.slot)
    sub = model.subdiv.get(key)!
  } else {
    const merged = normalizeSplit([...new Set<SplitAxis>([...sub.split, ...need])])!
    if (merged.join('') !== sub.split.join('')) {
      sub.children = remapChildren(sub.split, sub.children, merged)
      sub.split = merged
    }
  }
  const csize = splitChildSize(sub.split)
  sub.children.forEach((_, o) => {
    const co = splitChildOrigin([0, 0, 0], sub!.split, o)
    for (let a = 0; a < 3; a++) {
      if (co[a] < piece.origin[a] - EPS || co[a] + csize[a] > piece.origin[a] + piece.size[a] + EPS) return
    }
    // Restore the frozen shape only when the piece IS the whole child — a chamfered piece
    // landing on an over-split target (or a partial cover) lands as a plain slot instead.
    const exact = [0, 1, 2].every(
      (a) => Math.abs(co[a] - piece.origin[a]) < EPS && Math.abs(csize[a] - piece.size[a]) < EPS,
    )
    sub!.children[o] = exact && piece.chamfer ? { slot: piece.slot, chamfer: cloneChamfer(piece.chamfer) } : { slot: piece.slot }
  })
  sub.scaffold = false
  model.bounds = expandBounds(model.bounds, piece.cell)
  tidyCell(model, key)
}

/**
 * Drops a sub-voxel float: clears its (shifted) fine footprint, then writes its pieces. Whole
 * chamfer cells (atomic content, shift 0) are restored verbatim.
 */
export function applyFineClipboardAt(
  model: VoxelModel,
  plane: ConstructionPlane,
  clip: ClipboardData,
  originU: number,
  originV: number,
  subU: number,
  subV: number,
  gridExtent: GridExtent,
): void {
  const footprint = floatFootprintRegion(plane, clip, originU, originV, subU, subV)
  if (footprint) clearFineRegion(model, plane, footprint)
  for (const piece of floatPieces(plane, clip, originU, originV, subU, subV)) {
    if (!withinWorkingBounds(piece.cell, gridExtent)) continue
    writePiece(model, piece)
  }
  for (const cell of clip.cells) {
    if (!cell.chamfer || !cell.color) continue
    const coord = placeClipboardCell(plane, clip, originU, originV, cell)
    if (!withinWorkingBounds(coord, gridExtent)) continue
    const key = encodeKey(...coord)
    model.subdiv.delete(key)
    model.color.set(key, { paletteSlot: cell.color.paletteSlot })
    model.chamfer.set(key, cloneChamfer(cell.chamfer))
    model.bounds = expandBounds(model.bounds, coord)
  }
}

/** Display-space rect [x0, y0, x1, y1] (display cell units) of a piece projected onto `plane`. */
export function pieceDisplayRect(plane: ConstructionPlane, piece: FloatPiece): [number, number, number, number] {
  const { uDir, vDir } = planeLogicalBasis(plane.axis)
  const uA = axisIndex(worldAxisOf(uDir))
  const vA = axisIndex(worldAxisOf(vDir))
  const { u, v } = pixelFromGridCoord(plane, piece.cell)
  const mirrorsU = toDisplayU(plane, 0) !== 0
  const mirrorsV = toDisplayV(plane, 0) !== 0
  const loU = piece.origin[uA]
  const hiU = loU + piece.size[uA]
  const loV = piece.origin[vA]
  const hiV = loV + piece.size[vA]
  // Logical sub-range inside the voxel (logical u runs with +uDir), then mirror for display.
  const lu0 = uDir[uA] > 0 ? loU : 1 - hiU
  const lu1 = uDir[uA] > 0 ? hiU : 1 - loU
  const lv0 = vDir[vA] > 0 ? loV : 1 - hiV
  const lv1 = vDir[vA] > 0 ? hiV : 1 - loV
  const x0 = toDisplayU(plane, u) + (mirrorsU ? 1 - lu1 : lu0)
  const y0 = toDisplayV(plane, v) + (mirrorsV ? 1 - lv1 : lv0)
  return [x0, y0, x0 + (lu1 - lu0), y0 + (lv1 - lv0)]
}
