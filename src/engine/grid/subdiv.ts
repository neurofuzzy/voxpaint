import { decodeKey, encodeKey } from './GridStore'
import type { Axis, CellKey, ChamferCell, Coord, DetailChild, Orientation, SplitAxis, SubdivCell, VoxelModel } from './types'
import { childBits, childIndex, planeFrame, type CellBox } from './cellBox'
import type { NeighborSample } from '@/engine/chamfer/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'

/**
 * Detail-voxel (one-level subdivision) math and read helpers: split/child geometry, the grid
 * picker's divisions, iteration for renderers/exporters, transforms for floats, and the
 * subcell neighborhood the detail autotile classifies. Every WRITE goes through
 * `engine/grid/cellBox.ts` (`writeBox` / `recolorBox` / `normalizeCell`).
 */

/** Half-unit offset of octant `i` within its parent, in `x + 2*y + 4*z` order (the 8-split case). */
export function octantOffset(octant: number): Coord {
  return [octant & 1, (octant >> 1) & 1, (octant >> 2) & 1]
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

/**
 * Global grid divisions: the toolbar's 4-way grid picker arms one world-axis division that
 * every edit writes at. Halves cycle X → Y → Z; quarters cycle which world axis stays whole
 * (leave-X → leave-Y → leave-Z); octal is the single full 2×2×2; whole arms null.
 */
export const GRID_HALF_SPLITS = [['x'], ['y'], ['z']] as SplitAxis[][]
export const GRID_QUARTER_SPLITS = [
  ['y', 'z'],
  ['x', 'z'],
  ['x', 'y'],
] as SplitAxis[][]
export const GRID_FULL_SPLIT = ['x', 'y', 'z'] as SplitAxis[]

/** The picker family an armed division belongs to (derived — the split is the only state). */
export function gridFamilyOf(split: readonly SplitAxis[] | null): 'whole' | 'half' | 'quarter' | 'octal' {
  if (!split || split.length === 0) return 'whole'
  return split.length === 1 ? 'half' : split.length === 2 ? 'quarter' : 'octal'
}

/** Next division in a grid family's fixed world order, wrapping within the family. Unknown
 * divisions restart the family. */
export function advanceGridSplit(family: 'half' | 'quarter' | 'octal', current: SplitAxis[] | null): SplitAxis[] {
  const order = family === 'half' ? GRID_HALF_SPLITS : family === 'quarter' ? GRID_QUARTER_SPLITS : [GRID_FULL_SPLIT]
  const key = current ? [...current].sort().join(',') : ''
  const at = order.findIndex((s) => [...s].sort().join(',') === key)
  return [...(at === -1 ? order[0] : order[(at + 1) % order.length])]
}

/** Human label for an armed grid division in world terms, for toolbar/toast copy. */
export function describeGridSplit(split: SplitAxis[] | null): string {
  if (!split) return 'whole voxels'
  if (split.length === 3) return 'full 2×2×2'
  if (split.length === 2) {
    const world = [...split].sort().join('').toUpperCase()
    const left = (['x', 'y', 'z'] as SplitAxis[]).find((a) => !split.includes(a))!.toUpperCase()
    return `quarters in ${world} (${left} stays whole)`
  }
  return `halves along ${[...split].sort().join('').toUpperCase()}`
}

/** Child count for a split: 2 per split axis. */
export function splitChildCount(split: SplitAxis[]): number {
  return 2 ** split.length
}

/** Child index for per-axis half-bits, in split order (bit k = half along split[k]). */
export function splitChildIndex(split: SplitAxis[], dx: number, dy: number, dz: number): number {
  return childIndex(split, [dx, dy, dz])
}

/** Inverse of `splitChildIndex`: per-axis half-bits for a child index (0 on unsplit axes). */
export function splitChildBits(split: SplitAxis[], index: number): Coord {
  return childBits(split, index)
}

/** World-space size of one child: 0.5 on split axes, 1 elsewhere. */
export function splitChildSize(split: SplitAxis[]): [x: number, y: number, z: number] {
  const size: [number, number, number] = [1, 1, 1]
  for (const a of split) size[axisIndex(a)] = 0.5
  return size
}

/** World-space minimum corner of one child (exact halves, so weld quantization and CSG epsilon behave). */
export function splitChildOrigin(parent: Coord, split: SplitAxis[], index: number): [x: number, y: number, z: number] {
  const [dx, dy, dz] = splitChildBits(split, index)
  return [parent[0] + dx / 2, parent[1] + dy / 2, parent[2] + dz / 2]
}

/**
 * Splits the plain cube at `coord` into children along `split`, each inheriting its slot — a
 * construction helper for tests and fixtures (real edits use `writeBox`, which normalizes and
 * would fold this straight back). Returns false on empty, chamfered, or subdivided cells.
 */
export function subdivideCell(model: VoxelModel, coord: Coord, split: SplitAxis[] = ['x', 'y', 'z']): boolean {
  const key = encodeKey(...coord)
  const cell = model.color.get(key)
  if (!cell || model.chamfer.has(key) || model.subdiv.has(key)) return false
  const norm = normalizeSplit(split)
  if (!norm) return false
  model.color.delete(key)
  model.subdiv.set(key, {
    split: norm,
    // Distinct objects per child — shared refs would alias mutations across children.
    children: Array.from({ length: 2 ** norm.length }, () => ({ slot: cell.paletteSlot })),
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

/** A representative slot for a subdivided voxel (its first live child) — for whole-voxel
 * summaries like the 2D behind-layer and cell snapshots. */
export function subdivDisplaySlot(sub: SubdivCell): DetailChild['slot'] | undefined {
  return sub.children.find((c) => c !== null)?.slot
}

/** Deep-copy a chamfer cell (mirrors `cloneChamfer` without the tools/ import cycle). */
export function cloneChamferCell(c: ChamferCell): ChamferCell {
  return { planeAxis: c.planeAxis, planeOrientation: c.planeOrientation, resolvedTo: c.resolvedTo ? { ...c.resolvedTo } : null }
}

/** Total live (non-empty) children across the model — for ModelStats and perf guards. */
export function countSubdivChildren(model: VoxelModel): number {
  let count = 0
  for (const sub of model.subdiv.values()) {
    for (const child of sub.children) if (child !== null) count++
  }
  return count
}

/**
 * Every addressable voxel footprint in the model: plain color cells plus subdivided parents
 * (the two are mutually exclusive). The single iteration point for containment/assignment
 * walks (rig boxes, animation slices) so detail is never silently dropped.
 */
export function* voxelKeys(model: VoxelModel): Generator<CellKey> {
  yield* model.color.keys()
  yield* model.subdiv.keys()
}

/**
 * The children a logical 2D quadrant shows, viewer side first: every child whose in-plane half
 * matches the quadrant on the split axes (unsplit in-plane axes match any quadrant). Read-only —
 * for the 2D render and the eyedropper; writes address boxes (`gridBox`).
 */
export function quadrantSubcells(
  planeAxis: Axis,
  orientation: Orientation,
  split: SplitAxis[],
  qu: number,
  qv: number,
): number[] {
  const { uA, vA, wA, uPos, vPos } = planeFrame(planeAxis)
  const wFront = orientation === 1 ? 1 : 0
  const out: Array<{ i: number; front: boolean }> = []
  for (let i = 0; i < 2 ** split.length; i++) {
    const bits = childBits(split, i)
    const splitU = split.includes((['x', 'y', 'z'] as SplitAxis[])[uA])
    const splitV = split.includes((['x', 'y', 'z'] as SplitAxis[])[vA])
    const bu = uPos ? bits[uA] : 1 - bits[uA]
    const bv = vPos ? bits[vA] : 1 - bits[vA]
    if (splitU && bu !== qu) continue
    if (splitV && bv !== qv) continue
    out.push({ i, front: bits[wA] === wFront })
  }
  out.sort((a, b) => Number(b.front) - Number(a.front))
  return out.map((e) => e.i)
}

/**
 * The child a 2D view shows at logical quadrant (qu, qv): on a half-voxel plane stop only the
 * plane's slab is on the slice (a cutaway), otherwise the viewer-side live child wins. Null when
 * that part of the voxel is empty. Shared by the 2D render and the eyedropper so what you see
 * is what you sample.
 */
export function visibleChildAt(plane: ConstructionPlane, sub: SubdivCell, qu: number, qv: number): number | null {
  const wA = axisIndex(plane.axis)
  const cut = sub.split.includes(plane.axis)
  for (const i of quadrantSubcells(plane.axis, plane.orientation, sub.split, qu, qv)) {
    if (cut && plane.half !== null && childBits(sub.split, i)[wA] !== plane.half) continue
    if (sub.children[i]) return i
  }
  return null
}

/**
 * 8-neighborhood occupancy around a box inside `cell`, in the given plane's frame and at the
 * box's own depth — the subcell-resolution analogue of `sampleNeighbors` that the detail
 * autotile ("ramp"/"wedge") classifies. Neighbors are probed as world points at half-cell
 * granularity: one probe per narrow edge, two OR'd probes per full-width edge, diagonals
 * single-probed. A probe counts as filled when its world cell holds a plain/chamfer voxel or a
 * live child there; empty space and probes leaving the volume read empty. Sampled before the
 * box is written, so the box's own content never counts.
 */
export function sampleBoxNeighborhood(
  model: VoxelModel,
  plane: Pick<ConstructionPlane, 'axis'>,
  cell: Coord,
  box: CellBox,
): NeighborSample {
  const { uA, vA, wA, uPos, vPos } = planeFrame(plane.axis)
  const uDir: Coord = [0, 0, 0]
  const vDir: Coord = [0, 0, 0]
  uDir[uA] = uPos ? 1 : -1
  vDir[vA] = vPos ? 1 : -1
  // In-plane footprint in logical cell fractions (halved axes take their half, others fill).
  const span = (bit: 0 | 1 | null, pos: boolean): [number, number] => {
    if (bit === null) return [0, 1]
    const b = pos ? bit : 1 - bit
    return [b * 0.5, b * 0.5 + 0.5]
  }
  const [fu0, fu1] = span(box[uA], uPos)
  const [fv0, fv1] = span(box[vA], vPos)
  const depthFrac = box[wA] === null ? 0.5 : box[wA]! * 0.5 + 0.25
  // Logical [0,1] maps onto the cell footprint: negative-running axes need the +1 corner
  // correction (the same `-v - 1` that `gridCoordFromPixel` carries).
  const corr: Coord = [0, 0, 0]
  if (!uPos) corr[uA] = 1
  if (!vPos) corr[vA] = 1
  const xs = fu1 - fu0 > 0.5 ? [fu0 + 0.25, fu0 + 0.75] : [(fu0 + fu1) / 2]
  const ys = fv1 - fv0 > 0.5 ? [fv0 + 0.25, fv0 + 0.75] : [(fv0 + fv1) / 2]
  const atDepth = (fu: number, fv: number): boolean => {
    const probe: Coord = [
      cell[0] + corr[0] + fu * uDir[0] + fv * vDir[0],
      cell[1] + corr[1] + fu * uDir[1] + fv * vDir[1],
      cell[2] + corr[2] + fu * uDir[2] + fv * vDir[2],
    ]
    probe[wA] = cell[wA] + depthFrac
    const p = [Math.floor(probe[0]), Math.floor(probe[1]), Math.floor(probe[2])] as Coord
    if (model.color.has(encodeKey(...p))) return true
    const nsub = model.subdiv.get(encodeKey(...p))
    if (!nsub) return false
    const ni = childIndex(nsub.split, [0, 1, 2].map((a) => (probe[a] - p[a] >= 0.5 ? 1 : 0)))
    return nsub.children[ni] != null
  }
  const anyAtDepth = (fus: number[], fvs: number[]): boolean => fus.some((fu) => fvs.some((fv) => atDepth(fu, fv)))
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
    split: [...sub.split],
    children: sub.children.map((c) =>
      c ? { slot: c.slot, ...(c.chamfer ? { chamfer: cloneChamferCell(c.chamfer) } : {}) } : null,
    ),
  }
}

/**
 * Child bits in a plane's logical (u,v) frame plus the untouched depth bit. The u/v bits fold in
 * the basis signs, so callers can rotate or mirror in logical space exactly the way
 * `rotateClipboard90`/`mirrorClipboard` rotate clipboard du/dv.
 */
function toLogicalBits(planeAxis: Axis, bits: Coord): [bu: number, bv: number, w: number] {
  const { uA, vA, wA, uPos, vPos } = planeFrame(planeAxis)
  return [uPos ? bits[uA] : 1 - bits[uA], vPos ? bits[vA] : 1 - bits[vA], bits[wA]]
}

/** Inverse of `toLogicalBits`: logical (u,v) bits plus depth bit back to world bits. */
function fromLogicalBits(planeAxis: Axis, bu: number, bv: number, w: number): Coord {
  const { uA, vA, wA, uPos, vPos } = planeFrame(planeAxis)
  const bits: Coord = [0, 0, 0]
  bits[uA] = uPos ? bu : 1 - bu
  bits[vA] = vPos ? bv : 1 - bv
  bits[wA] = w
  return bits
}

/**
 * The split axes after a 90° turn about the plane axis: the two in-plane axes exchange roles
 * (a u-split turned on its side is a v-split), the depth axis is untouched.
 */
export function rotatedSplitAxes(split: SplitAxis[], planeAxis: Axis): SplitAxis[] {
  const { uA, vA } = planeFrame(planeAxis)
  const names: SplitAxis[] = ['x', 'y', 'z']
  const swapped = split.map((a) => (a === names[uA] ? names[vA] : a === names[vA] ? names[uA] : a))
  return [...new Set(swapped)].sort() as SplitAxis[]
}

/**
 * Rotates a subdiv entry's children 90° in the given plane's logical (u,v) frame — the same
 * frame and direction convention as `rotateClipboard90`. Returns the rotated split alongside the
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
    const [bu, bv, w] = toLogicalBits(planeAxis, childBits(split, i))
    const [nu, nv] = direction === 'cw' ? [1 - bv, bu] : [bv, 1 - bu]
    out[childIndex(to, fromLogicalBits(planeAxis, nu, nv, w))] = children[i] ?? null
  }
  return { split: to, children: out }
}

/**
 * Mirrors a subdiv entry's children in the given plane's logical (u,v) frame — the same frame
 * convention as `mirrorClipboard`. Returns a fresh children array.
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
    const [bu, bv, w] = toLogicalBits(planeAxis, childBits(split, i))
    out[childIndex(split, fromLogicalBits(planeAxis, mirrorU ? 1 - bu : bu, mirrorV ? 1 - bv : bv, w))] = children[i] ?? null
  }
  return out
}
