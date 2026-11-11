import { decodeKey, encodeKey } from './GridStore'
import type { Axis, CellKey, ChamferCell, Coord, DetailChild, Orientation, SplitAxis, SubdivCell, VoxelModel } from './types'
import type { NeighborSample } from '@/engine/chamfer/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'

/**
 * Detail-voxel (one-level subdivision) helpers. A plain solid cube can be replaced by 2, 4,
 * or 8 half-scale children along the split world axes, stored as one `SubdivCell` under the
 * parent's CellKey; the parent's `color`/`chamfer` cells are removed while subdivided. All
 * functions below mutate `model` in place — call them inside an Immer producer or on an owned
 * model — and return whether they changed anything (so strokes stay no-op-correct).
 */

/** Half-unit offset of octant `i` within its parent, in `x + 2*y + 4*z` order (the 8-split case). */
export function octantOffset(octant: number): Coord {
  return [octant & 1, (octant >> 1) & 1, (octant >> 2) & 1]
}

/** Inverse of `octantOffset`: octant index for a per-axis half-offset of 0 or 1. */
export function octantIndex(dx: number, dy: number, dz: number): number {
  return dx + 2 * dy + 4 * dz
}

/**
 * World-space minimum corner of one half-scale child of a fully-split (8-way) parent. Exact
 * halves (0.5 is exactly representable), so downstream weld quantization and CSG epsilon behave.
 */
export function childOrigin(parent: Coord, octant: number): [x: number, y: number, z: number] {
  const [dx, dy, dz] = octantOffset(octant)
  return [parent[0] + dx / 2, parent[1] + dy / 2, parent[2] + dz / 2]
}

/** True for 1–3 distinct world axes (order-free — use `normalizeSplit` for x,y,z order). */
export function isValidSplit(split: SplitAxis[]): boolean {
  return split.length >= 1 && split.length <= 3 && new Set(split).size === split.length && split.every((a) => a === 'x' || a === 'y' || a === 'z')
}

/** Dedupes and x,y,z-orders a split, or null when it isn't 1–3 distinct world axes. */
export function normalizeSplit(split: SplitAxis[]): SplitAxis[] | null {
  if (!isValidSplit(split)) return null
  const order = { x: 0, y: 1, z: 2 }
  return [...new Set(split)].sort((a, b) => order[a] - order[b])
}

/** Human label for a split ("8" renders as 2×2×2). */
export function describeSplit(split: SplitAxis[]): string {
  if (split.length === 3) return '2×2×2'
  if (split.length === 2) return `quarters in ${[...split].sort().join('').toUpperCase()}`
  return `halves along ${split[0].toUpperCase()}`
}

/**
 * View-relative axes for a construction plane: U/V span the 2D canvas, W is the plane
 * normal. Subdivision choices are presented and cycled in these terms (U → V → W), mapped
 * back to world axes for storage — so "halves along U" always splits along the canvas
 * horizontal no matter which face you're looking through.
 */
export function planeUVW(axis: Axis): { u: SplitAxis; v: SplitAxis; w: SplitAxis } {
  const { uDir, vDir } = planeLogicalBasis(axis)
  return {
    u: (uDir[0] !== 0 ? 'x' : uDir[1] !== 0 ? 'y' : 'z') as SplitAxis,
    v: (vDir[0] !== 0 ? 'x' : vDir[1] !== 0 ? 'y' : 'z') as SplitAxis,
    w: axis,
  }
}

/**
 * Division families per plane, in tap-cycle order: single-axis halves (U → V → W), then
 * the three quarter-planes (each named by the view axis it leaves whole), then the full
 * split. The single source of truth for the toolbar picker and tap-to-advance, so both
 * cycle the same orders.
 */
export function subdivFamiliesForPlane(axis: Axis): { two: SplitAxis[][]; four: SplitAxis[][]; eight: SplitAxis[][] } {
  const { u, v, w } = planeUVW(axis)
  const norm = (s: SplitAxis[]): SplitAxis[] => [...s].sort() as SplitAxis[]
  return {
    two: [[u], [v], [w]],
    four: [norm([v, w]), norm([u, w]), norm([u, v])],
    eight: [norm([u, v, w])],
  }
}

/** Human label for a split in view terms ("halves along U (X)"), for toolbar/toast copy. */
export function describeSplitUVW(split: SplitAxis[], axis: Axis): string {
  const { u, v } = planeUVW(axis)
  const toUVW = (a: SplitAxis): string => (a === u ? 'U' : a === v ? 'V' : 'W')
  const letters = [...split].sort().map(toUVW).join('')
  const world = [...split].sort().join('').toUpperCase()
  if (split.length === 3) return '2×2×2'
  if (split.length === 2) return `quarters in ${letters} (${world})`
  return `halves along ${letters} (${world})`
}

/**
 * Next division in the split's own family cycle on the given plane (U → V → W, then the
 * quarter-planes in leave-U/V/W order, then full) — or null when it should coarsen back
 * to whole past the end. Never changes the child count; only the final merge back to a
 * whole voxel does. Unknown splits hold instead of destroying.
 */
export function advanceSplit(split: SplitAxis[], axis: Axis): SplitAxis[] | null {
  const { two, four, eight } = subdivFamiliesForPlane(axis)
  const key = [...split].sort().join(',')
  for (const family of [two, four, eight]) {
    const at = family.findIndex((s) => [...s].sort().join(',') === key)
    if (at === -1) continue
    return at + 1 < family.length ? [...family[at + 1]] : null
  }
  return [...split]
}

/**
 * Re-houses children from one split into another by volume overlap: each new child inherits
 * the old child covering most of its box (ties break to the lower old index). Erased holes
 * stay holes where the overlap winner is empty. Lets re-splitting preserve painted detail
 * instead of wiping it.
 */
export function remapChildren(oldSplit: SplitAxis[], oldChildren: (DetailChild | null)[], newSplit: SplitAxis[]): (DetailChild | null)[] {
  const overlap = (aMin: number[], aSize: number[], bMin: number[], bSize: number[]): number => {
    let v = 1
    for (let j = 0; j < 3; j++) {
      v *= Math.max(0, Math.min(aMin[j] + aSize[j], bMin[j] + bSize[j]) - Math.max(aMin[j], bMin[j]))
    }
    return v
  }
  return Array.from({ length: 2 ** newSplit.length }, (_, n) => {
    const nMin = splitChildOrigin([0, 0, 0], newSplit, n)
    const nSize = splitChildSize(newSplit)
    let best = -1
    let bestVol = 0
    for (let o = 0; o < oldChildren.length; o++) {
      if (!oldChildren[o]) continue
      const oMin = splitChildOrigin([0, 0, 0], oldSplit, o)
      const oSize = splitChildSize(oldSplit)
      const v = overlap(nMin, nSize, oMin, oSize)
      if (v > bestVol) {
        bestVol = v
        best = o
      }
    }
    if (best < 0) return null
    const src = oldChildren[best]!
    return { slot: src.slot, ...(src.chamfer ? { chamfer: cloneChamferCell(src.chamfer) } : {}) }
  })
}

/** Child count for a split: 2 per split axis. */
export function splitChildCount(split: SplitAxis[]): number {
  return 2 ** split.length
}

/** Child index for per-axis half-bits, in split order (bit k = half along split[k]). */
export function splitChildIndex(split: SplitAxis[], dx: number, dy: number, dz: number): number {
  const bits = { x: dx, y: dy, z: dz }
  let idx = 0
  split.forEach((a, k) => {
    idx += bits[a] * 2 ** k
  })
  return idx
}

/** Inverse of `splitChildIndex`: per-axis half-bits for a child index (0 on unsplit axes). */
export function splitChildBits(split: SplitAxis[], index: number): Coord {
  const out: Coord = [0, 0, 0]
  split.forEach((a, k) => {
    out[axisIndex(a)] = (index >> k) & 1
  })
  return out
}

/** World-space size of one child: 0.5 on split axes, 1 elsewhere. */
export function splitChildSize(split: SplitAxis[]): [x: number, y: number, z: number] {
  const size: [number, number, number] = [1, 1, 1]
  for (const a of split) size[axisIndex(a)] = 0.5
  return size
}

/**
 * World-space minimum corner of one child. Exact halves, like `childOrigin` (which is this
 * with the full `['x','y','z']` split).
 */
export function splitChildOrigin(parent: Coord, split: SplitAxis[], index: number): [x: number, y: number, z: number] {
  const [dx, dy, dz] = splitChildBits(split, index)
  return [parent[0] + dx / 2, parent[1] + dy / 2, parent[2] + dz / 2]
}

/** True when `coord` holds a plain solid cube eligible for subdivision (solids only — chamfered cells never subdivide). */
export function canSubdivide(model: VoxelModel, coord: Coord): boolean {
  const key = encodeKey(...coord)
  return model.color.has(key) && !model.chamfer.has(key) && !model.subdiv.has(key)
}

/**
 * True when `coord` holds nothing at all — eligible for a scaffold split (an empty detail
 * parent to paint into later). Chamfered cells never split; subdivided cells cycle within
 * their family (a different toolbar family re-splits them instead).
 */
export function canScaffold(model: VoxelModel, coord: Coord): boolean {
  const key = encodeKey(...coord)
  return !model.color.has(key) && !model.chamfer.has(key) && !model.subdiv.has(key)
}

/**
 * Replaces the plain cube at `coord` with half-scale children along `split` (1–3 distinct
 * world axes; normalized to x,y,z order), each inheriting the parent's slot. Returns false
 * (no-op) on empty, chamfered, or already-subdivided cells, or an invalid split.
 */
export function subdivideCell(model: VoxelModel, coord: Coord, split: SplitAxis[] = ['x', 'y', 'z']): boolean {
  const key = encodeKey(...coord)
  const cell = model.color.get(key)
  if (!cell || model.chamfer.has(key) || model.subdiv.has(key)) return false
  const norm = normalizeSplit(split)
  if (!norm) return false
  model.color.delete(key)
  model.subdiv.set(key, {
    slot: cell.paletteSlot,
    split: norm,
    // Distinct objects per child — shared refs would alias mutations across children.
    children: Array.from({ length: 2 ** norm.length }, () => ({ slot: cell.paletteSlot })),
  })
  return true
}

/**
 * Coarsens a subdivided parent back to the single cube it was subdivided from, restoring
 * the stored original slot exactly (not a majority vote of the children — predictable).
 * A scaffold (split from empty space) deletes instead — there is no cube to restore.
 * Returns false (no-op) when the cell isn't subdivided.
 */
export function coarsenCell(model: VoxelModel, coord: Coord): boolean {
  const key = encodeKey(...coord)
  const sub = model.subdiv.get(key)
  if (!sub) return false
  model.subdiv.delete(key)
  if (!sub.scaffold) model.color.set(key, { paletteSlot: sub.slot })
  return true
}

/**
 * Splits empty space into a scaffold: a subdiv entry with all-null children and the given
 * placeholder slot (rendered dimmed in 2D, invisible in 3D until painted). Painting,
 * erasing, remap, render, and export all treat null children as holes, so a scaffold
 * behaves exactly like an erased-then-kept subdivision — except erasing its last live
 * child still deletes the entry. Returns false (no-op) on occupied or invalid splits.
 */
export function scaffoldCell(
  model: VoxelModel,
  coord: Coord,
  split: SplitAxis[],
  slot: PaletteSlotRef,
): boolean {
  const key = encodeKey(...coord)
  if (model.color.has(key) || model.chamfer.has(key) || model.subdiv.has(key)) return false
  const norm = normalizeSplit(split)
  if (!norm) return false
  model.subdiv.set(key, {
    slot,
    split: norm,
    scaffold: true,
    children: Array.from({ length: 2 ** norm.length }, () => null),
  })
  return true
}

/** Reads the subdiv entry at a parent coord, if any. */
export function getSubdivCell(model: VoxelModel, coord: Coord): SubdivCell | undefined {
  return model.subdiv.get(encodeKey(...coord))
}

/** True when `coord` is a subdivided parent (has no color/chamfer cell of its own). */
export function isSubdivided(model: VoxelModel, coord: Coord): boolean {
  return model.subdiv.has(encodeKey(...coord))
}

/** True when `index` addresses a child of the given subdiv entry. */
export function isValidSubCellIndex(sub: SubdivCell, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < sub.children.length
}

/**
 * Recolors one child (preserving its chamfer, if any). Returns false (no-op) when the parent
 * isn't subdivided or the index is out of range.
 */
export function paintSubCell(model: VoxelModel, coord: Coord, index: number, slot: PaletteSlotRef): boolean {
  const sub = model.subdiv.get(encodeKey(...coord))
  if (!sub || !isValidSubCellIndex(sub, index)) return false
  const cur = sub.children[index]
  sub.children[index] = cur ? { ...cur, slot } : { slot }
  return true
}

/**
 * Writes one child wholesale (slot + optional frozen chamfer), deep-copying the chamfer so
 * snapshots/clipboard never share references with the live model. Returns false (no-op) when
 * the parent isn't subdivided or the index is out of range.
 */
export function writeSubCell(model: VoxelModel, coord: Coord, index: number, child: DetailChild): boolean {
  const sub = model.subdiv.get(encodeKey(...coord))
  if (!sub || !isValidSubCellIndex(sub, index)) return false
  sub.children[index] = child.chamfer
    ? { slot: child.slot, chamfer: cloneChamferCell(child.chamfer) }
    : { slot: child.slot }
  return true
}

/** Deep-copy a chamfer cell (mirrors `cloneChamfer` without the tools/ import cycle). */
export function cloneChamferCell(c: ChamferCell): ChamferCell {
  return { planeAxis: c.planeAxis, planeOrientation: c.planeOrientation, resolvedTo: c.resolvedTo ? { ...c.resolvedTo } : null }
}

/**
 * Erases one child (sets it to `null`). Erasing every child deletes the entry entirely —
 * unlike coarsening, the parent's original slot is NOT restored, because there is nothing
 * left to restore. Returns false (no-op) when the parent isn't subdivided or the index is
 * out of range.
 */
/**
 * Nulls one detail child (erase). Never deletes the entry — content-only erases keep the
 * subdivision so it can be repainted; clearing an already-empty entry is the store
 * actions' job (eraseDetailQuadrants/eraseSubCellAtCoord delete when nothing was live).
 * Returns whether a live child was nulled.
 */
export function eraseSubCell(model: VoxelModel, coord: Coord, index: number): boolean {
  const key: CellKey = encodeKey(...coord)
  const sub = model.subdiv.get(key)
  if (!sub || !isValidSubCellIndex(sub, index)) return false
  if (sub.children[index] === null) return false
  sub.children[index] = null
  return true
}

/** Total live (non-erased) children across the model — for ModelStats and perf guards. */
export function countSubdivChildren(model: VoxelModel): number {
  let count = 0
  for (const sub of model.subdiv.values()) {
    for (const child of sub.children) if (child !== null) count++
  }
  return count
}

/**
 * Every addressable voxel footprint in the model: plain color cells plus subdivided parents
 * (the two are mutually exclusive — a subdiv parent has no color cell). The single iteration
 * point for containment/assignment walks (rig boxes, animation slices) so detail is never
 * silently dropped from a set built off `model.color` alone.
 */
export function* voxelKeys(model: VoxelModel): Generator<CellKey> {
  yield* model.color.keys()
  yield* model.subdiv.keys()
}

/**
 * The children a 2D quadrant addresses: every child whose in-plane quarter matches the
 * quadrant on the split axes (unsplit in-plane axes don't constrain — a depth stack paints
 * its full column from anywhere on its face), front-sorted (viewer side first) for
 * eyedropper-style sampling. An 8-split yields the depth pair; a uv-split yields one
 * child; a single-axis split yields the children sharing that half. Painting a quadrant
 * always paints the whole set.
 */
export function quadrantSubcells(
  planeAxis: Axis,
  orientation: Orientation,
  split: SplitAxis[],
  qu: number,
  qv: number,
): number[] {
  const { uDir, vDir } = planeLogicalBasis(planeAxis)
  const uAxis = (uDir[0] !== 0 ? 'x' : uDir[1] !== 0 ? 'y' : 'z') as SplitAxis
  const vAxis = (vDir[0] !== 0 ? 'x' : vDir[1] !== 0 ? 'y' : 'z') as SplitAxis
  const wAxis = axisIndex(planeAxis)
  const wFront = orientation === 1 ? 1 : 0
  const out: Array<{ i: number; front: boolean }> = []
  for (let i = 0; i < 2 ** split.length; i++) {
    const [dx, dy, dz] = splitChildBits(split, i)
    const bits = { x: dx, y: dy, z: dz }
    // Only split axes constrain the match — unsplit in-plane axes match every quadrant
    // (a depth stack paints its full column from anywhere on its face).
    const needU = split.includes(uAxis)
    const needV = split.includes(vAxis)
    const bu = uDir[axisIndex(uAxis)] > 0 ? bits[uAxis] : 1 - bits[uAxis]
    const bv = vDir[axisIndex(vAxis)] > 0 ? bits[vAxis] : 1 - bits[vAxis]
    if (needU && bu !== qu) continue
    if (needV && bv !== qv) continue
    out.push({ i, front: [dx, dy, dz][wAxis] === wFront })
  }
  out.sort((a, b) => Number(b.front) - Number(a.front))
  return out.map((e) => e.i)
}

/**
 * Whether a detail child intersects the half-step slab (`half` world-axis bit, null =
 * whole-voxel mode). Children of splits that exclude the plane axis span the full depth,
 * so they intersect every slab; depth-split children intersect only their own bit.
 * The single predicate every half-step edit path (2D quadrant clips, 3D per-child writes,
 * the 2D slab-dimmed render) filters through.
 */
export function childInSlab(split: SplitAxis[], planeAxis: Axis, half: 0 | 1 | null, index: number): boolean {
  if (half === null) return true
  if (!split.includes(planeAxis)) return true
  return splitChildBits(split, index)[axisIndex(planeAxis)] === half
}

/**
 * Viewer-side depth bit for a plane facing: the slab whole-mode paint addresses. A paint
 * tap never edits two subvoxels at once — it lands on the front-most child, and the back
 * half is reachable by half-stepping the plane instead.
 */
export function frontSlabBit(orientation: Orientation): 0 | 1 {
  return orientation === 1 ? 1 : 0
}

/**
 * 8-neighborhood occupancy around one detail child, in the given plane's frame and at the
 * child's own depth slab — the subcell-resolution analogue of `sampleNeighbors` that the
 * auto-bevel ("ramp"/"wedge") kinds classify in subdivided voxels. Neighbors are probed as
 * world points at half-cell granularity: the half-cells directly adjacent to the child's
 * own in-plane footprint (one probe per narrow edge, two OR'd probes per full-width edge
 * so wide children read both halves, diagonals always single-probed).
 *
 * A probe counts as filled when its world cell holds a plain cube or a live detail child
 * of any kind (frozen shapes count as occupied, mirroring the unit-scale "occupied at all"
 * rule) — erased holes and empty space read empty, and probes that leave the working
 * volume naturally read empty. This is what lets a bevel painted in one subdivided voxel
 * respond to children living in adjacent subdivided parents.
 */
export function sampleDetailNeighborhood(
  model: VoxelModel,
  plane: ConstructionPlane,
  parent: Coord,
  index: number,
): NeighborSample {
  const sub = model.subdiv.get(encodeKey(...parent))
  const split = sub?.split ?? (['x', 'y', 'z'] as SplitAxis[])
  const ai = axisIndex(plane.axis)
  const { uDir, vDir } = planeLogicalBasis(plane.axis)
  const uAxis = (uDir[0] !== 0 ? 'x' : uDir[1] !== 0 ? 'y' : 'z') as SplitAxis
  const vAxis = (vDir[0] !== 0 ? 'x' : vDir[1] !== 0 ? 'y' : 'z') as SplitAxis
  const [dx, dy, dz] = splitChildBits(split, index)
  const bits = { x: dx, y: dy, z: dz }
  // Logical-frame bits (direction-corrected exactly like `quadrantSubcells`, so the
  // footprint agrees with the quadrant that addresses this child).
  const bu = uDir[axisIndex(uAxis)] > 0 ? bits[uAxis] : 1 - bits[uAxis]
  const bv = vDir[axisIndex(vAxis)] > 0 ? bits[vAxis] : 1 - bits[vAxis]
  // In-plane footprint in logical cell fractions (split axes halve, spanning axes fill).
  const fu0 = split.includes(uAxis) ? bu * 0.5 : 0
  const fu1 = split.includes(uAxis) ? bu * 0.5 + 0.5 : 1
  const fv0 = split.includes(vAxis) ? bv * 0.5 : 0
  const fv1 = split.includes(vAxis) ? bv * 0.5 + 0.5 : 1
  // Depth center of the child's own slab (mid-cell when it spans the full depth).
  const depthFrac = split.includes(plane.axis) ? bits[plane.axis] * 0.5 + 0.25 : 0.5
  // Logical [0,1] maps onto the parent footprint: negative-running axes need the +1
  // corner correction (the same `-v - 1` that `gridCoordFromPixel` carries), otherwise
  // probes on mirrored planes land a full cell off.
  const corr: Coord = [
    uDir[0] < 0 || vDir[0] < 0 ? 1 : 0,
    uDir[1] < 0 || vDir[1] < 0 ? 1 : 0,
    uDir[2] < 0 || vDir[2] < 0 ? 1 : 0,
  ]
  // Wide edges read both halves (OR); narrow edges and diagonals probe once.
  const xs = fu1 - fu0 > 0.5 ? [fu0 + 0.25, fu0 + 0.75] : [(fu0 + fu1) / 2]
  const ys = fv1 - fv0 > 0.5 ? [fv0 + 0.25, fv0 + 0.75] : [(fv0 + fv1) / 2]
  // Depth is pinned per probe (world-space assignment keeps TS narrowing simple).
  const atDepth = (fu: number, fv: number): boolean => {
    const probe: Coord = [
      parent[0] + corr[0] + fu * uDir[0] + fv * vDir[0],
      parent[1] + corr[1] + fu * uDir[1] + fv * vDir[1],
      parent[2] + corr[2] + fu * uDir[2] + fv * vDir[2],
    ]
    probe[ai] = parent[ai] + depthFrac
    const px = Math.floor(probe[0])
    const py = Math.floor(probe[1])
    const pz = Math.floor(probe[2])
    if (model.color.has(encodeKey(px, py, pz))) return true
    const nsub = model.subdiv.get(encodeKey(px, py, pz))
    if (!nsub) return false
    const bit = (f: number, p: number): number => (f - p >= 0.5 ? 1 : 0)
    // Non-split axes are ignored by splitChildIndex, so their bits ride along harmlessly.
    const ni = splitChildIndex(nsub.split, bit(probe[0], px), bit(probe[1], py), bit(probe[2], pz))
    return nsub.children[ni] !== null && nsub.children[ni] !== undefined
  }
  const anyAtDepth = (fus: number[], fvs: number[]): boolean =>
    fus.some((fu) => fvs.some((fv) => atDepth(fu, fv)))
  return {
    N: anyAtDepth(xs, [fv0 - 0.25]),
    S: anyAtDepth(xs, [fv1 + 0.25]),
    E: anyAtDepth([fu1 + 0.25], ys),
    W: anyAtDepth([fu0 - 0.25], ys),
    NE: atDepth(fu1 + 0.25, fv0 - 0.25),
    NW: atDepth(fu0 - 0.25, fv0 - 0.25),
    SE: atDepth(fu1 + 0.25, fv1 + 0.25),
    SW: atDepth(fu0 - 0.25, fv1 + 0.25),
  }
}

/**
 * Line segments for one voxel's hover wireframe: the 12 outer box edges plus one
 * mid-plane square per split axis (the same squares DetailEdgesOverlay draws per cell).
 * Grid-native coordinates — the caller wraps them in a BufferGeometry. A null split
 * (plain voxel, no pending division) yields just the box.
 */
export function voxelWireframeSegments(cell: Coord, split: SplitAxis[] | null): Array<[Coord, Coord]> {
  const [cx, cy, cz] = cell
  const corner = (i: number, j: number, k: number): Coord => [cx + i, cy + j, cz + k]
  const corners = [
    corner(0, 0, 0), corner(1, 0, 0), corner(1, 1, 0), corner(0, 1, 0),
    corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1),
  ]
  const edgePairs: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const segments: Array<[Coord, Coord]> = edgePairs.map(([a, b]) => [corners[a], corners[b]])
  if (split) {
    const base = [cx, cy, cz]
    for (const a of split) {
      const ai = axisIndex(a)
      const at = base[ai] + 0.5
      const others = [0, 1, 2].filter((j) => j !== ai)
      const mid = (bj: number, bk: number): Coord => {
        const q: Coord = [cx, cy, cz]
        q[others[0]] = base[others[0]] + bj
        q[others[1]] = base[others[1]] + bk
        q[ai] = at
        return q
      }
      const c00 = mid(0, 0)
      const c10 = mid(1, 0)
      const c11 = mid(1, 1)
      const c01 = mid(0, 1)
      segments.push([c00, c10], [c10, c11], [c11, c01], [c01, c00])
    }
  }
  return segments
}
/**
 * Logical-frame footprint of one subdiv child on a 2D plane: fractional
 * `[u0, v0, u1, v1]` within the parent cell, in `planeLogicalBasis` coordinates.
 * Unsplit in-plane axes span the full cell; split in-plane axes span the child's half
 * (direction-corrected). NOT display space — mirror through the plane's display mirrors
 * before drawing (see `subdivDisplayFootprint` in engine/tools/quadrant.ts), or mirrored
 * planes highlight the wrong half.
 * Every child in a `quadrantSubcells` set shares the same footprint
 * (set members differ only on depth/unsplit axes), so the hover outline and any other
 * per-target overlay can use the first member's footprint to show exactly what a paint
 * tap would hit — a half for single-axis splits, the full cell for depth-only splits,
 * a quarter for 8-splits.
 */
export function subdivChildFootprint(
  planeAxis: Axis,
  split: SplitAxis[],
  index: number,
): [u0: number, v0: number, u1: number, v1: number] {
  const { uDir, vDir } = planeLogicalBasis(planeAxis)
  const uAxis = (uDir[0] !== 0 ? 'x' : uDir[1] !== 0 ? 'y' : 'z') as SplitAxis
  const vAxis = (vDir[0] !== 0 ? 'x' : vDir[1] !== 0 ? 'y' : 'z') as SplitAxis
  const [dx, dy, dz] = splitChildBits(split, index)
  const bits = { x: dx, y: dy, z: dz }
  const span = (dir: [number, number, number], axis: SplitAxis): [number, number] => {
    if (!split.includes(axis)) return [0, 1]
    const b = dir[axisIndex(axis)] > 0 ? bits[axis] : 1 - bits[axis]
    return b === 0 ? [0, 0.5] : [0.5, 1]
  }
  const [u0, u1] = span(uDir, uAxis)
  const [v0, v1] = span(vDir, vAxis)
  return [u0, v0, u1, v1]
}

/**
 * Iterates every live child in the model: the parent's CellKey, the child index, its
 * fractional min-corner origin and size, and the child entry. The single iteration point for
 * renderers, bakers, and exporters so none of them re-derive split math.
 */
export function forEachSubdivChild(
  model: VoxelModel,
  cb: (
    parentKey: CellKey,
    index: number,
    origin: [x: number, y: number, z: number],
    size: [x: number, y: number, z: number],
    child: DetailChild,
  ) => void,
): void {
  for (const [parentKey, sub] of model.subdiv) {
    const parent = decodeKey(parentKey)
    const size = splitChildSize(sub.split)
    for (let i = 0; i < sub.children.length; i++) {
      const child = sub.children[i]
      if (!child) continue
      cb(parentKey, i, splitChildOrigin(parent, sub.split, i), size, child)
    }
  }
}

/** Deep-copy a subdiv entry so snapshots/clipboard never share references with the live model. */
export function cloneSubdiv(sub: SubdivCell): SubdivCell {
  return {
    slot: sub.slot,
    split: [...sub.split],
    ...(sub.scaffold ? { scaffold: true as const } : {}),
    children: sub.children.map((c) =>
      c ? { slot: c.slot, ...(c.chamfer ? { chamfer: cloneChamferCell(c.chamfer) } : {}) } : null,
    ),
  }
}

/**
 * Child bits in a plane's logical (u,v) frame plus the untouched depth bit. The u/v bits
 * fold in the basis signs (a `-x` uDir means u=0 is the x-high half), so callers can rotate or
 * mirror in logical space exactly the way `rotateClipboard90`/`mirrorClipboard` rotate
 * clipboard du/dv — the detail stays glued to its cells.
 */
function toLogicalBits(planeAxis: Axis, dx: number, dy: number, dz: number): [bu: number, bv: number, w: number] {
  const { uDir, vDir } = planeLogicalBasis(planeAxis)
  const bits = [dx, dy, dz]
  const pick = (dir: Coord): number => {
    const ai = axisIndex(dir[0] !== 0 ? 'x' : dir[1] !== 0 ? 'y' : 'z')
    const bit = bits[ai]
    return dir[ai] > 0 ? bit : 1 - bit
  }
  return [pick(uDir), pick(vDir), bits[axisIndex(planeAxis)]]
}

/** Inverse of `toLogicalBits`: logical (u,v) bits plus depth bit back to an octant index. */
function fromLogicalBits(planeAxis: Axis, bu: number, bv: number, w: number): number {
  const { uDir, vDir } = planeLogicalBasis(planeAxis)
  const bits = [0, 0, 0]
  const put = (dir: Coord, bit: number): void => {
    const ai = axisIndex(dir[0] !== 0 ? 'x' : dir[1] !== 0 ? 'y' : 'z')
    bits[ai] = dir[ai] > 0 ? bit : 1 - bit
  }
  put(uDir, bu)
  put(vDir, bv)
  bits[axisIndex(planeAxis)] = w
  return octantIndex(bits[0], bits[1], bits[2])
}

/**
 * The split axes after a 90° turn about the plane axis: the two in-plane axes exchange
 * roles (a u-split turned on its side is a v-split), the depth axis is untouched. Quarter
 * turns in either direction swap the same pair, so direction doesn't matter — only the set.
 */
export function rotatedSplitAxes(split: SplitAxis[], planeAxis: Axis): SplitAxis[] {
  const { uDir, vDir } = planeLogicalBasis(planeAxis)
  const uAxis = (uDir[0] !== 0 ? 'x' : uDir[1] !== 0 ? 'y' : 'z') as SplitAxis
  const vAxis = (vDir[0] !== 0 ? 'x' : vDir[1] !== 0 ? 'y' : 'z') as SplitAxis
  const swapped = split.map((a) => (a === uAxis ? vAxis : a === vAxis ? uAxis : a))
  return [...new Set(swapped)].sort() as SplitAxis[]
}

/**
 * Rotates a subdiv entry's children 90° in the given plane's logical (u,v) frame — the same
 * frame and direction convention as `rotateClipboard90`, so a rotated float's detail matches
 * its rotated cells. Returns the rotated split (in-plane axes exchange roles) alongside the
 * fresh children array (slot refs shared — slots are immutable values).
 */
export function rotateSubdivChildren(
  children: (DetailChild | null)[],
  split: SplitAxis[],
  planeAxis: Axis,
  direction: 'cw' | 'ccw' = 'cw',
): { split: SplitAxis[]; children: (DetailChild | null)[] } {
  const to = rotatedSplitAxes(split, planeAxis)
  const out: (DetailChild | null)[] = new Array(children.length).fill(null)
  for (let i = 0; i < children.length; i++) {
    const [dx, dy, dz] = splitChildBits(split, i)
    const [bu, bv, w] = toLogicalBits(planeAxis, dx, dy, dz)
    const [nu, nv] = direction === 'cw' ? [1 - bv, bu] : [bv, 1 - bu]
    const [rx, ry, rz] = octantOffset(fromLogicalBits(planeAxis, nu, nv, w))
    out[splitChildIndex(to, rx, ry, rz)] = children[i] ?? null
  }
  return { split: to, children: out }
}

/**
 * Mirrors a subdiv entry's children in the given plane's logical (u,v) frame — the same
 * frame convention as `mirrorClipboard`, so a mirrored float's detail matches its mirrored
 * cells. Returns a fresh children array.
 */
export function mirrorSubdivChildren(
  children: (DetailChild | null)[],
  split: SplitAxis[],
  planeAxis: Axis,
  mirrorU: boolean,
  mirrorV: boolean,
): (DetailChild | null)[] {
  const out: (DetailChild | null)[] = new Array(children.length).fill(null)
  for (let i = 0; i < children.length; i++) {
    const [dx, dy, dz] = splitChildBits(split, i)
    const [bu, bv, w] = toLogicalBits(planeAxis, dx, dy, dz)
    const [rx, ry, rz] = octantOffset(fromLogicalBits(planeAxis, mirrorU ? 1 - bu : bu, mirrorV ? 1 - bv : bv, w))
    out[splitChildIndex(split, rx, ry, rz)] = children[i] ?? null
  }
  return out
}
