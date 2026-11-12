import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord, DetailChild, GridExtent, VoxelModel } from '@/engine/grid/types'
import { splitChildOrigin, splitChildSize } from '@/engine/grid/subdiv'
import { boxFromOriginSize, frontSlabBit, planeFrame, writeBox } from '@/engine/grid/cellBox'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { pixelFromGridCoord, planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { ClipboardCell, ClipboardData, FloatOrigin, SelectionRegion } from '@/store/types'
import { cloneChamfer, placeClipboardCell } from './clipboard'
import { fineDivisionFor, worldAxisOf } from './fineSelection'

/**
 * Off-grid floats: a float whose content or position isn't whole-voxel — content copied from a
 * sub-voxel selection (moves in fine half-voxel steps in-plane), or any paste the construction
 * plane's half-voxel stop shifts in depth (`FloatOrigin.subW`). Such a float is placed as PIECES:
 * each child (or plain cube) as a world box, shifted, cut at voxel boundaries, and written with
 * `writeBox` into whatever voxel it lands in. Dropping first clears the float's footprint (its
 * selected fine cells, or its whole cells), so a drop replaces exactly what it covers.
 *
 * Bevels follow the cellBox rule: a beveled child survives when the shift keeps it whole (a
 * 0.5-sized child moved by half a voxel lands on one child); a shift that cuts it lands it as a
 * plain block. Whole chamfer CELLS have no half-voxel position at all, so content holding one is
 * "atomic": its float only ever sits at whole-voxel offsets (`fineFloatAtomic`, enforced where
 * origins are set) and the drop restores those cells verbatim.
 */

/** True when the content holds a whole chamfer cell — unit-scale frozen geometry with no
 * half-voxel position, so the float stays at whole-voxel offsets. Beveled detail children do NOT
 * count. */
export function fineFloatAtomic(clip: ClipboardData): boolean {
  return clip.cells.some((c) => !!c.chamfer)
}

/** True when the float drops as pieces: sub-voxel content, or any half-voxel offset. */
export function floatIsPieced(clip: ClipboardData, origin: FloatOrigin): boolean {
  return !!clip.fine || !!origin.subU || !!origin.subV || !!origin.subW
}

/**
 * The in-plane step a float drag moves in: the armed grid's resolution on the plane (half voxels
 * along each in-plane axis the grid cuts), or null for whole voxels. The grid is the control for
 * every float, whatever its content; whole bevels are snapped back to whole voxels by the store.
 */
export function floatDragStep(plane: ConstructionPlane, grid: Parameters<typeof fineDivisionFor>[1]): { su: 1 | 2; sv: 1 | 2 } | null {
  const { su, sv } = fineDivisionFor(plane, grid)
  return su === 1 && sv === 1 ? null : { su, sv }
}

/**
 * The float origin a drag lands on: `du`/`dv` are pointer deltas in the drag's step units per
 * logical axis (half voxels where `step` is 2, whole voxels where it is 1). Half-voxel steps carry
 * between the cell origin and the 0/1 sub offset; whole steps keep the sub offset the drag
 * started with. The depth shift rides along unchanged.
 */
export function draggedFloatOrigin(start: FloatOrigin, step: { su: 1 | 2; sv: 1 | 2 }, du: number, dv: number): FloatOrigin {
  const along = (o: number, sub: number, s: 1 | 2, d: number): [number, number] => {
    if (s === 1) return [o + d, sub]
    const f = o * 2 + sub + d
    const no = Math.floor(f / 2)
    return [no, f - no * 2]
  }
  const [originU, subU] = along(start.originU, start.subU ?? 0, step.su, du)
  const [originV, subV] = along(start.originV, start.subV ?? 0, step.sv, dv)
  return { originU, originV, subU, subV, ...(start.subW ? { subW: start.subW } : {}) }
}

export type FloatPiece = {
  /** The voxel the piece lies in. */
  cell: Coord
  /** Lower corner inside the voxel (each 0 or 0.5) and size (each 0.5 or 1). */
  origin: [number, number, number]
  size: [number, number, number]
  slot: PaletteSlotRef
  /** Frozen shape of the source child — present only when the placement keeps the child whole. */
  chamfer?: DetailChild['chamfer']
}

const EPS = 1e-6

/** World shift (grid units) of a float origin's sub offsets: half voxels along logical u / v
 * and along the world plane axis. */
function worldShift(plane: ConstructionPlane, origin: FloatOrigin): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  const { uA, vA, wA, uPos, vPos } = planeFrame(plane.axis)
  out[uA] += (uPos ? 1 : -1) * 0.5 * (origin.subU ?? 0)
  out[vA] += (vPos ? 1 : -1) * 0.5 * (origin.subV ?? 0)
  out[wA] += 0.5 * (origin.subW ?? 0)
  return out
}

type CellPiece = { origin: [number, number, number]; size: [number, number, number]; slot: PaletteSlotRef; chamfer?: DetailChild['chamfer'] }

function cellPieces(cell: ClipboardCell): CellPiece[] {
  if (cell.subdiv) {
    const out: CellPiece[] = []
    const size = splitChildSize(cell.subdiv.split)
    for (let o = 0; o < cell.subdiv.children.length; o++) {
      const child = cell.subdiv.children[o]
      if (!child) continue
      out.push({ origin: splitChildOrigin([0, 0, 0], cell.subdiv.split, o), size, slot: child.slot, ...(child.chamfer ? { chamfer: cloneChamfer(child.chamfer) } : {}) })
    }
    return out
  }
  if (cell.color && !cell.chamfer) return [{ origin: [0, 0, 0], size: [1, 1, 1], slot: cell.color.paletteSlot }]
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

/** A world box cut into per-voxel boxes: `[cell, in-voxel origin, size]` triples. */
function cutWorldBox(lo: number[], size: readonly number[]): Array<{ cell: Coord; origin: [number, number, number]; size: [number, number, number] }> {
  const out: Array<{ cell: Coord; origin: [number, number, number]; size: [number, number, number] }> = []
  for (const [x0, x1] of segments(lo[0], lo[0] + size[0])) {
    for (const [y0, y1] of segments(lo[1], lo[1] + size[1])) {
      for (const [z0, z1] of segments(lo[2], lo[2] + size[2])) {
        const cell: Coord = [Math.floor(x0 + EPS), Math.floor(y0 + EPS), Math.floor(z0 + EPS)]
        out.push({ cell, origin: [x0 - cell[0], y0 - cell[1], z0 - cell[2]], size: [x1 - x0, y1 - y0, z1 - z0] })
      }
    }
  }
  return out
}

/** Every piece of a float at `origin` (cell origin plus sub offsets), cut to single voxels. */
export function floatPieces(plane: ConstructionPlane, clip: ClipboardData, origin: FloatOrigin): FloatPiece[] {
  const shift = worldShift(plane, origin)
  const out: FloatPiece[] = []
  for (const cell of clip.cells) {
    const base = placeClipboardCell(plane, clip, origin.originU, origin.originV, cell)
    for (const piece of cellPieces(cell)) {
      const parts = cutWorldBox([0, 1, 2].map((a) => base[a] + piece.origin[a] + shift[a]), piece.size)
      // A bevel survives only when the shift keeps its child whole (one part); a cut bevel is
      // unrepresentable and lands as a plain block of its slot.
      const keepBevel = piece.chamfer && parts.length === 1
      for (const part of parts) {
        out.push({ ...part, slot: piece.slot, ...(keepBevel ? { chamfer: piece.chamfer } : {}) })
      }
    }
  }
  return out
}

/** Exact world bounds (lo/hi corners) of a pieced float's content inside the volume, or null. */
export function floatPieceBounds(plane: ConstructionPlane, clip: ClipboardData, origin: FloatOrigin, gridExtent: GridExtent): { lo: Coord; hi: Coord } | null {
  const lo: Coord = [Infinity, Infinity, Infinity]
  const hi: Coord = [-Infinity, -Infinity, -Infinity]
  let any = false
  for (const p of floatPieces(plane, clip, origin)) {
    if (!withinWorkingBounds(p.cell, gridExtent)) continue
    any = true
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p.cell[a] + p.origin[a])
      hi[a] = Math.max(hi[a], p.cell[a] + p.origin[a] + p.size[a])
    }
  }
  return any ? { lo, hi } : null
}

/**
 * The boxes a drop clears (replace semantics): the selected fine cells of sub-voxel content (at
 * its slab, or full depth), or every whole clipboard cell (explicitly empty ones included) —
 * shifted exactly like the pieces.
 */
function floatClearBoxes(plane: ConstructionPlane, clip: ClipboardData, origin: FloatOrigin) {
  const shift = worldShift(plane, origin)
  const out: ReturnType<typeof cutWorldBox> = []
  const f = clip.fine
  if (!f) {
    for (const cell of clip.cells) {
      const base = placeClipboardCell(plane, clip, origin.originU, origin.originV, cell)
      out.push(...cutWorldBox([0, 1, 2].map((a) => base[a] + shift[a]), [1, 1, 1]))
    }
    return out
  }
  const { uA, vA, wA, uPos, vPos } = planeFrame(plane.axis)
  const fw = clip.width * f.su
  for (let i = 0; i < f.mask.length; i++) {
    if (f.mask[i] !== 1) continue
    const fu = i % fw
    const fv = Math.floor(i / fw)
    const du = Math.floor(fu / f.su)
    const dv = Math.floor(fv / f.sv)
    const base = placeClipboardCell(plane, clip, origin.originU, origin.originV, { du, dv, dw: 0 })
    const lo = [base[0], base[1], base[2]]
    const size = [1, 1, 1]
    if (f.su === 2) {
      const iu = fu - du * 2
      size[uA] = 0.5
      lo[uA] += (uPos ? iu : 1 - iu) * 0.5
    }
    if (f.sv === 2) {
      const iv = fv - dv * 2
      size[vA] = 0.5
      lo[vA] += (vPos ? iv : 1 - iv) * 0.5
    }
    if (f.slab !== null) {
      size[wA] = 0.5
      lo[wA] += f.slab * 0.5
    }
    out.push(...cutWorldBox([0, 1, 2].map((a) => lo[a] + shift[a]), size))
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
  // Content shifted half a voxel along an axis it isn't cut on is footprinted at half-voxel
  // resolution there (whole-cell content included).
  const f0 = clip.fine ?? (subU || subV ? wholeCellsAsFine(clip) : null)
  if (!f0) return null
  const f = upsampleFine(f0, clip.width, clip.height, subU ? 2 : f0.su, subV ? 2 : f0.sv)
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

type FineFootprint = NonNullable<ClipboardData['fine']>

/** A whole-cell clipboard's footprint as a 1×1-per-cell fine mask (full depth). */
function wholeCellsAsFine(clip: ClipboardData): FineFootprint {
  const mask = new Uint8Array(clip.width * clip.height)
  for (const c of clip.cells) mask[c.dv * clip.width + c.du] = 1
  return { su: 1, sv: 1, slab: null, mask }
}

/** Re-samples a fine footprint to at least `su`×`sv` fine cells per voxel (duplicating cells). */
function upsampleFine(f: FineFootprint, width: number, height: number, su: 1 | 2, sv: 1 | 2): FineFootprint {
  if (su === f.su && sv === f.sv) return f
  const fw = width * su
  const mask = new Uint8Array(fw * height * sv)
  for (let y = 0; y < height * sv; y++) {
    for (let x = 0; x < fw; x++) {
      const sx = Math.floor((x * f.su) / su)
      const sy = Math.floor((y * f.sv) / sv)
      mask[y * fw + x] = f.mask[sy * width * f.su + sx]
    }
  }
  return { su, sv, slab: f.slab, mask }
}

/**
 * Drops a pieced float (`floatIsPieced`): clears its shifted footprint, then writes its pieces,
 * each a `writeBox` (folding back to whole voxels where the result is uniform). Whole chamfer
 * cells (atomic content, whole-voxel offsets only) are restored verbatim.
 */
export function applyFloatAt(model: VoxelModel, plane: ConstructionPlane, clip: ClipboardData, origin: FloatOrigin, gridExtent: GridExtent): void {
  for (const box of floatClearBoxes(plane, clip, origin)) {
    if (withinWorkingBounds(box.cell, gridExtent)) writeBox(model, box.cell, boxFromOriginSize(box.origin, box.size), null)
  }
  for (const piece of floatPieces(plane, clip, origin)) {
    if (!withinWorkingBounds(piece.cell, gridExtent)) continue
    const box = boxFromOriginSize(piece.origin, piece.size)
    writeBox(model, piece.cell, box, piece.chamfer ? { slot: piece.slot, chamfer: cloneChamfer(piece.chamfer) } : { slot: piece.slot })
  }
  for (const cell of clip.cells) {
    if (!cell.chamfer || !cell.color) continue
    const coord = placeClipboardCell(plane, clip, origin.originU, origin.originV, cell)
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
