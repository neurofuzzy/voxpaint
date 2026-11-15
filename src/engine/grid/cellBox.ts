import { encodeKey, expandBounds } from './GridStore'
import type { Axis, CellKey, Coord, DetailChild, SplitAxis, VoxelModel } from './types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'

/**
 * The single write path for sub-voxel editing. Every edit — paint, erase, recolor, fill,
 * float drops, fine-selection clears — addresses a `CellBox` (a grid-resolution box inside one
 * voxel) and goes through `writeBox` / `recolorBox`. Both treat every voxel uniformly as a
 * split plus children: a plain or chamfered voxel is simply the empty split with one child, so
 * there is no separate "whole voxel" vs "detail" code path, and both normalize afterwards, so
 * solid areas always collapse back to plain voxels (no redundant subdivisions).
 *
 * Invariants kept by every function here:
 * - A bevel (chamfered child) only ever occupies exactly one child box. Whenever a split would
 *   cut it, it becomes a plain block of its slot — a cut bevel is unrepresentable.
 * - A stored subdivision always carries detail: uniform plain children fold to one voxel, and
 *   all-empty entries are deleted (`normalizeCell`).
 */

/** One axis of a `CellBox`: `null` spans the whole voxel, 0/1 is the low/high half. */
export type HalfBit = 0 | 1 | null
/** A grid-resolution box inside one voxel, per world axis (x, y, z). */
export type CellBox = [x: HalfBit, y: HalfBit, z: HalfBit]

export const WHOLE_BOX: CellBox = [null, null, null]
const AXES: SplitAxis[] = ['x', 'y', 'z']

/** World axis index of a basis direction (`planeLogicalBasis` uDir/vDir). */
export function dirAxisIndex(dir: readonly number[]): 0 | 1 | 2 {
  return dir[0] !== 0 ? 0 : dir[1] !== 0 ? 1 : 2
}

/**
 * A plane's in-plane frame as world axis indices: u/v axes, whether logical u/v run along
 * +world, and the depth (plane) axis. The one place callers derive this from `planeLogicalBasis`.
 */
export function planeFrame(axis: Axis): { uA: 0 | 1 | 2; vA: 0 | 1 | 2; wA: 0 | 1 | 2; uPos: boolean; vPos: boolean } {
  const { uDir, vDir } = planeLogicalBasis(axis)
  const uA = dirAxisIndex(uDir)
  const vA = dirAxisIndex(vDir)
  return { uA, vA, wA: (3 - uA - vA) as 0 | 1 | 2, uPos: uDir[uA] > 0, vPos: vDir[vA] > 0 }
}

/** Viewer-side depth half for a plane facing — the slab a plane on a half-voxel stop enters on. */
export function frontSlabBit(orientation: 1 | -1): 0 | 1 {
  return orientation === 1 ? 1 : 0
}

export function isWholeBox(box: CellBox): boolean {
  return box[0] === null && box[1] === null && box[2] === null
}

/** World axes the box halves (the split a voxel needs for the box to be a union of children). */
export function boxSplitAxes(box: CellBox): SplitAxis[] {
  return AXES.filter((_, i) => box[i] !== null)
}

/** World-space min corner and size of a box inside `cell`. */
export function boxWorld(cell: Coord, box: CellBox): { origin: [number, number, number]; size: [number, number, number] } {
  const origin: [number, number, number] = [cell[0], cell[1], cell[2]]
  const size: [number, number, number] = [1, 1, 1]
  for (let a = 0; a < 3; a++) {
    const b = box[a]
    if (b === null) continue
    size[a] = 0.5
    origin[a] += b * 0.5
  }
  return { origin, size }
}

/** The box a fractional in-cell origin/size describes (origins 0 or 0.5, sizes 0.5 or 1). */
export function boxFromOriginSize(origin: readonly number[], size: readonly number[]): CellBox {
  const bit = (a: number): HalfBit => (size[a] > 0.75 ? null : origin[a] >= 0.25 ? 1 : 0)
  return [bit(0), bit(1), bit(2)]
}

/**
 * Logical 2D quadrant (`quadrantFromFractions`, already unmirrored) → world half-bits on the
 * plane's u/v axes. The plane-axis entry is 0 (the plane's slab decides depth).
 */
export function worldBitsFromQuad(plane: Pick<ConstructionPlane, 'axis'>, qu: number, qv: number): Coord {
  const { uA, vA, uPos, vPos } = planeFrame(plane.axis)
  const bits: Coord = [0, 0, 0]
  bits[uA] = uPos ? qu : 1 - qu
  bits[vA] = vPos ? qv : 1 - qv
  return bits
}

/** World half-bits of a grid-space point inside `cell` (each axis: is the point in the high half). */
export function worldBitsAtPoint(point: readonly number[], cell: Coord): Coord {
  return [0, 1, 2].map((a) => (point[a] - cell[a] >= 0.5 ? 1 : 0)) as Coord
}

/** World half-bits of a 3D face hit inside `cell`: the hit point nudged just inside the face
 * (along -normal), so the clicked surface's own voxel part is addressed. */
export function faceHitBits(point: readonly number[], cell: Coord, axis: Axis, orientation: 1 | -1): Coord {
  const p = [point[0], point[1], point[2]]
  p[AXES.indexOf(axis)] -= orientation * 1e-3
  return worldBitsAtPoint(p, cell)
}

/**
 * The box a plane-targeted edit addresses under the armed grid: on each axis the grid cuts, the
 * plane axis takes the plane's slab (`plane.half`, else the viewer-side half) and in-plane axes
 * take the pointer's half (`inPlaneBits`, world half-bits — null spans the whole extent, e.g.
 * fills and synthetic events). Axes the grid doesn't cut span the voxel. A null grid is always
 * the whole voxel: the grid is the control, so "whole" writes whole voxels.
 */
export function gridBox(plane: ConstructionPlane, grid: readonly SplitAxis[] | null, inPlaneBits: Coord | null): CellBox {
  const box: CellBox = [null, null, null]
  if (!grid) return box
  const wA = AXES.indexOf(plane.axis)
  for (const a of grid) {
    const i = AXES.indexOf(a)
    if (i === wA) box[i] = plane.half ?? frontSlabBit(plane.orientation)
    else box[i] = inPlaneBits ? (inPlaneBits[i] as 0 | 1) : null
  }
  return box
}

/** The box of grid resolution containing a point (3D voxel taps): every cut axis takes the point's half. */
export function gridBoxAtBits(grid: readonly SplitAxis[] | null, bits: Coord): CellBox {
  const box: CellBox = [null, null, null]
  for (const a of grid ?? []) {
    const i = AXES.indexOf(a)
    box[i] = bits[i] as 0 | 1
  }
  return box
}

/** Display-space footprint of a box on a 2D plane, as fractions of the cell (mirror-aware). */
export function boxDisplayRect(
  plane: ConstructionPlane,
  box: CellBox,
  mirrorsU: boolean,
  mirrorsV: boolean,
): [u0: number, v0: number, u1: number, v1: number] {
  const { uA, vA, uPos, vPos } = planeFrame(plane.axis)
  const span = (bit: HalfBit, pos: boolean, mirror: boolean): [number, number] => {
    if (bit === null) return [0, 1]
    let logical = pos ? bit : 1 - bit
    if (mirror) logical = 1 - logical
    return logical === 0 ? [0, 0.5] : [0.5, 1]
  }
  const [u0, u1] = span(box[uA], uPos, mirrorsU)
  const [v0, v1] = span(box[vA], vPos, mirrorsV)
  return [u0, v0, u1, v1]
}

// ---------------------------------------------------------------------------------------------
// Split/child math on the uniform (split, children) view. An empty split is a plain voxel.
// ---------------------------------------------------------------------------------------------

/** Per-world-axis half-bits of child `index` (0 on axes the split doesn't cut). */
export function childBits(split: readonly SplitAxis[], index: number): Coord {
  const out: Coord = [0, 0, 0]
  split.forEach((a, k) => {
    out[AXES.indexOf(a)] = (index >> k) & 1
  })
  return out
}

/** Child index for per-world-axis half-bits (bits on unsplit axes are ignored). */
export function childIndex(split: readonly SplitAxis[], bits: readonly number[]): number {
  let idx = 0
  split.forEach((a, k) => {
    idx += (bits[AXES.indexOf(a)] & 1) << k
  })
  return idx
}

/** The box child `index` occupies. */
export function childBox(split: readonly SplitAxis[], index: number): CellBox {
  const bits = childBits(split, index)
  return AXES.map((a, i) => (split.includes(a) ? (bits[i] as 0 | 1) : null)) as CellBox
}

/** True when child `index` lies inside `box` (requires the split to resolve every box axis). */
export function childInBox(split: readonly SplitAxis[], index: number, box: CellBox): boolean {
  const bits = childBits(split, index)
  for (let i = 0; i < 3; i++) {
    const b = box[i]
    if (b === null) continue
    if (!split.includes(AXES[i])) return false
    if (bits[i] !== b) return false
  }
  return true
}

/** True when child `index` overlaps `box` (any child spanning a halved axis overlaps it). */
export function childOverlapsBox(split: readonly SplitAxis[], index: number, box: CellBox): boolean {
  const bits = childBits(split, index)
  for (let i = 0; i < 3; i++) {
    const b = box[i]
    if (b === null || !split.includes(AXES[i])) continue
    if (bits[i] !== b) return false
  }
  return true
}

function sortSplit(axes: Iterable<SplitAxis>): SplitAxis[] {
  return AXES.filter((a) => [...axes].includes(a))
}

function cloneChild(c: DetailChild | null): DetailChild | null {
  if (!c) return null
  return c.chamfer
    ? { slot: c.slot, chamfer: { planeAxis: c.chamfer.planeAxis, planeOrientation: c.chamfer.planeOrientation, resolvedTo: c.chamfer.resolvedTo ? { ...c.chamfer.resolvedTo } : null } }
    : { slot: c.slot }
}

/** Two children merge losslessly: both empty, or the same plain slot (bevels never merge). */
function sameMergeable(a: DetailChild | null, b: DetailChild | null): boolean {
  if (a === null || b === null) return a === b
  return !a.chamfer && !b.chamfer && a.slot.kind === b.slot.kind && a.slot.index === b.slot.index
}

/** The uniform view of one voxel. */
export type CellDetail = { split: SplitAxis[]; children: (DetailChild | null)[] }

/** Reads any voxel as a split + children (plain/chamfer voxels are the empty split). */
export function readCellDetail(model: VoxelModel, key: CellKey): CellDetail {
  const sub = model.subdiv.get(key)
  if (sub) return { split: [...sub.split], children: sub.children.map(cloneChild) }
  const color = model.color.get(key)
  if (!color) return { split: [], children: [null] }
  const chamfer = model.chamfer.get(key)
  return { split: [], children: [cloneChild(chamfer ? { slot: color.paletteSlot, chamfer } : { slot: color.paletteSlot })] }
}

/**
 * Re-houses children into a finer split (`to` ⊇ `from`). A child the new split cuts loses its
 * bevel (a cut bevel is unrepresentable) and lands as a plain block of its slot; uncut children
 * carry over verbatim.
 */
export function refineChildren(from: readonly SplitAxis[], children: readonly (DetailChild | null)[], to: readonly SplitAxis[]): (DetailChild | null)[] {
  const cuts = to.length > from.length
  return Array.from({ length: 2 ** to.length }, (_, n) => {
    const src = children[childIndex(from, childBits(to, n))] ?? null
    if (!src) return null
    return cuts && src.chamfer ? { slot: src.slot } : cloneChild(src)
  })
}

/** Drops split axis `axis`, keeping the low-half child of every pair (callers check mergeability). */
function mergeAxis(split: SplitAxis[], children: (DetailChild | null)[], axis: SplitAxis): CellDetail {
  const next = split.filter((a) => a !== axis)
  return {
    split: next,
    children: Array.from({ length: 2 ** next.length }, (_, n) => children[childIndex(split, childBits(next, n))]),
  }
}

/** Whether every pair along `axis` that satisfies `consider` merges losslessly. */
function axisMergeable(split: SplitAxis[], children: (DetailChild | null)[], axis: SplitAxis, consider: (i: number) => boolean): boolean {
  const ai = AXES.indexOf(axis)
  for (let i = 0; i < children.length; i++) {
    const bits = childBits(split, i)
    if (bits[ai] !== 0 || !consider(i)) continue
    bits[ai] = 1
    if (!sameMergeable(children[i], children[childIndex(split, bits)])) return false
  }
  return true
}

/** Folds every losslessly-mergeable split axis (uniform plain pairs, empty pairs). */
function normalizeDetail(d: CellDetail): CellDetail {
  let cur = d
  let changed = true
  while (changed && cur.split.length > 0) {
    changed = false
    for (const axis of cur.split) {
      if (axisMergeable(cur.split, cur.children, axis, () => true)) {
        cur = mergeAxis(cur.split, cur.children, axis)
        changed = true
        break
      }
    }
  }
  return cur
}

/** Writes a (normalized) detail view back to the model's three layers. */
function storeCellDetail(model: VoxelModel, cell: Coord, key: CellKey, d: CellDetail): void {
  if (d.split.length === 0) {
    model.subdiv.delete(key)
    const c = d.children[0]
    if (!c) {
      model.color.delete(key)
      model.chamfer.delete(key)
      return
    }
    model.color.set(key, { paletteSlot: c.slot })
    if (c.chamfer) model.chamfer.set(key, c.chamfer)
    else model.chamfer.delete(key)
    model.bounds = expandBounds(model.bounds, cell)
    return
  }
  model.color.delete(key)
  model.chamfer.delete(key)
  model.subdiv.set(key, { split: d.split, children: d.children })
  model.bounds = expandBounds(model.bounds, cell)
}

/**
 * Folds a voxel's subdivision as far as it losslessly goes: uniform plain children become one
 * voxel, all-empty entries are deleted. Never touches bevels. No-op on non-subdivided cells.
 */
export function normalizeCell(model: VoxelModel, cell: Coord): void {
  const key = encodeKey(...cell)
  if (!model.subdiv.has(key)) return
  storeCellDetail(model, cell, key, normalizeDetail(readCellDetail(model, key)))
}

/**
 * The split a bevel written into `box` would live under, or null when the box can't be exactly
 * one child (the voxel is cut finer than the box along an axis whose out-of-box content can't
 * merge) — the write then lands as a plain block. Pure: the ghost and the write share it.
 */
function bevelSplit(d: CellDetail, box: CellBox): CellDetail | null {
  const need = boxSplitAxes(box)
  let cur: CellDetail = { split: sortSplit([...d.split, ...need]), children: refineChildren(d.split, d.children, sortSplit([...d.split, ...need])) }
  for (const axis of cur.split.filter((a) => !need.includes(a))) {
    // In-box children are about to be overwritten — only the content outside the box must merge.
    if (!axisMergeable(cur.split, cur.children, axis, (i) => !childInBox(cur.split, i, box))) return null
    cur = mergeAxis(cur.split, cur.children, axis)
  }
  return cur
}

/** True when a bevel written into `box` on this voxel keeps its shape (see `writeBox`). */
export function bevelFitsBox(model: VoxelModel, cell: Coord, box: CellBox): boolean {
  return bevelSplit(readCellDetail(model, encodeKey(...cell)), box) !== null
}

/**
 * THE sub-voxel write: replaces exactly `box` of the voxel at `cell` with `content` (null =
 * erase). The voxel is split just far enough for the box (cutting any bevel the split crosses
 * down to a plain block), the box is written, and the result is normalized — a whole box writes
 * a plain/chamfer voxel, a box restoring uniformity folds back to one voxel, erasing the last
 * content deletes it. A bevel occupies exactly one child: when the voxel is cut finer than the
 * box (and the content outside can't merge), the bevel lands as a plain block of its slot.
 */
export function writeBox(model: VoxelModel, cell: Coord, box: CellBox, content: DetailChild | null): void {
  const key = encodeKey(...cell)
  const before = readCellDetail(model, key)
  let d: CellDetail
  let child = cloneChild(content)
  if (child?.chamfer) {
    const fitted = bevelSplit(before, box)
    if (fitted) d = fitted
    else {
      child = { slot: child.slot }
      const split = sortSplit([...before.split, ...boxSplitAxes(box)])
      d = { split, children: refineChildren(before.split, before.children, split) }
    }
  } else {
    const split = sortSplit([...before.split, ...boxSplitAxes(box)])
    d = { split, children: refineChildren(before.split, before.children, split) }
  }
  d.children = d.children.map((c, i) => (childInBox(d.split, i, box) ? cloneChild(child) : c))
  storeCellDetail(model, cell, key, normalizeDetail(d))
}

/**
 * Recolor-only write: swaps the slot of the live content inside `box`, never adding, deleting,
 * or reshaping anything. A plain voxel splits to recolor part of it; a bevel the split would
 * cut is recolored whole instead (geometry never changes). Returns whether any slot changed.
 */
export function recolorBox(model: VoxelModel, cell: Coord, box: CellBox, slot: PaletteSlotRef): boolean {
  const key = encodeKey(...cell)
  const before = readCellDetail(model, key)
  const need = boxSplitAxes(box)
  const wouldCut = need.some((a) => !before.split.includes(a)) && before.children.some((c) => c?.chamfer)
  let d: CellDetail = before
  if (!wouldCut) {
    const split = sortSplit([...before.split, ...need])
    d = { split, children: refineChildren(before.split, before.children, split) }
  }
  let changed = false
  d.children = d.children.map((c, i) => {
    if (!c || !childOverlapsBox(d.split, i, box)) return c
    if (c.slot.kind === slot.kind && c.slot.index === slot.index) return c
    changed = true
    return { ...c, slot }
  })
  if (!changed) return false
  storeCellDetail(model, cell, key, normalizeDetail(d))
  return true
}

/** The child index whose box is exactly `box` on a subdivided voxel, or null (whole voxels, or no exact child). */
export function exactChildIndex(model: VoxelModel, cell: Coord, box: CellBox): number | null {
  const sub = model.subdiv.get(encodeKey(...cell))
  if (!sub) return null
  const need = boxSplitAxes(box)
  if (need.length !== sub.split.length || need.some((a) => !sub.split.includes(a))) return null
  return childIndex(sub.split, box.map((b) => b ?? 0))
}

/** The content at exactly `box` (whole voxels read at the whole box; null when empty or not one child). */
export function contentAtBox(model: VoxelModel, cell: Coord, box: CellBox): DetailChild | null {
  const key = encodeKey(...cell)
  if (isWholeBox(box) && !model.subdiv.has(key)) return readCellDetail(model, key).children[0]
  const idx = exactChildIndex(model, cell, box)
  return idx === null ? null : model.subdiv.get(key)!.children[idx]
}
