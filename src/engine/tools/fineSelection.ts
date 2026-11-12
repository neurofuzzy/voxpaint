import type { CellKey, Coord, SplitAxis } from '@/engine/grid/types'
import { encodeKey } from '@/engine/grid/GridStore'
import { boxFromOriginSize, frontSlabBit, type CellBox } from '@/engine/grid/cellBox'
import { gridCoordFromPixel, planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { FineSelection, SelectionRegion } from '@/store/types'
import { quadrantFromFractions } from './quadrant'
import { forEachSelectedCell, isCellSelected, lassoRegion, rectRegion } from './selectionMask'

/**
 * Sub-voxel (grid-resolution) selection. The grid division decides the resolution: along logical
 * u / v the voxel is cut in two when the grid cuts that world axis, and the plane's own axis picks
 * a slab. A "fine cell" is one such piece; fine units run `cell * s + sub` (sub 0/1, logical
 * order, so mirrored planes need no special casing in the data — only in drawing).
 */
export type FineDivision = { su: 1 | 2; sv: 1 | 2; slab: 0 | 1 | null }

export function worldAxisOf(dir: readonly number[]): SplitAxis {
  return (dir[0] !== 0 ? 'x' : dir[1] !== 0 ? 'y' : 'z') as SplitAxis
}

/** The fine division the armed grid gives selections on `plane`. */
export function fineDivisionFor(plane: ConstructionPlane, split: SplitAxis[] | null): FineDivision {
  if (!split) return { su: 1, sv: 1, slab: null }
  const { uDir, vDir } = planeLogicalBasis(plane.axis)
  const planeAxis = ['x', 'y', 'z'][axisIndex(plane.axis)] as SplitAxis
  return {
    su: split.includes(worldAxisOf(uDir)) ? 2 : 1,
    sv: split.includes(worldAxisOf(vDir)) ? 2 : 1,
    slab: split.includes(planeAxis) ? (plane.half ?? frontSlabBit(plane.orientation)) : null,
  }
}

export function isWholeDivision(d: FineDivision): boolean {
  return d.su === 1 && d.sv === 1 && d.slab === null
}

/** Fine (u,v) of a pointer event: the cell plus the half the pointer is in (mirror-corrected). */
export function fineUnitAt(
  div: FineDivision,
  plane: ConstructionPlane,
  u: number,
  v: number,
  cu: number | undefined,
  cv: number | undefined,
): [number, number] {
  const q = quadrantFromFractions(plane, cu, cv) ?? [0, 0]
  return [u * div.su + (div.su === 2 ? q[0] : 0), v * div.sv + (div.sv === 2 ? q[1] : 0)]
}

/** Rectangle of fine cells between two fine-unit corners (inclusive), as a region. */
export function fineRectRegion(div: FineDivision, f0u: number, f0v: number, f1u: number, f1v: number): SelectionRegion {
  if (isWholeDivision(div)) return rectRegion(f0u, f0v, f1u, f1v)
  const { su, sv } = div
  const fu0 = Math.min(f0u, f1u)
  const fu1 = Math.max(f0u, f1u)
  const fv0 = Math.min(f0v, f1v)
  const fv1 = Math.max(f0v, f1v)
  const originU = Math.floor(fu0 / su)
  const originV = Math.floor(fv0 / sv)
  const width = Math.floor(fu1 / su) - originU + 1
  const height = Math.floor(fv1 / sv) - originV + 1
  const fw = width * su
  const fh = height * sv
  const fmask = new Uint8Array(fw * fh)
  const cover = new Uint8Array(width * height)
  for (let fv = fv0; fv <= fv1; fv++) {
    for (let fu = fu0; fu <= fu1; fu++) {
      fmask[(fv - originV * sv) * fw + (fu - originU * su)] = 1
      cover[(Math.floor(fv / sv) - originV) * width + (Math.floor(fu / su) - originU)] = 1
    }
  }
  return { originU, originV, width, height, mask: cover, fine: { su, sv, slab: div.slab, mask: fmask } }
}

/** A freehand (lasso) path traced in fine units, as a region at the division's resolution: the
 * fine cells whose centers fall inside the path. Whole divisions are the plain cell lasso. */
export function fineLassoRegion(div: FineDivision, points: ReadonlyArray<readonly [number, number]>): SelectionRegion | null {
  const r = lassoRegion(points)
  if (!r || isWholeDivision(div)) return r
  const cells: Array<[number, number]> = []
  forEachSelectedCell(r, (fu, fv) => cells.push([fu, fv]))
  return regionFromFineCells(div, cells)
}

/** True when the fine cell (fu,fv) is selected (a coarse region counts whole cells). */
export function isFineSelected(region: SelectionRegion, fu: number, fv: number): boolean {
  const f = region.fine
  if (!f) return isCellSelected(region, fu, fv)
  const x = fu - region.originU * f.su
  const y = fv - region.originV * f.sv
  const fw = region.width * f.su
  if (x < 0 || x >= fw || y < 0 || y >= region.height * f.sv) return false
  return f.mask[y * fw + x] === 1
}

/** Whether a paint/erase at cell (u,v) and logical quadrant (qu,qv) lies inside the selection. */
export function isSelectedAt(
  region: SelectionRegion,
  plane: ConstructionPlane,
  u: number,
  v: number,
  qu?: number,
  qv?: number,
): boolean {
  const f = region.fine
  if (!f) return isCellSelected(region, u, v)
  if (!isCellSelected(region, u, v)) return false
  // The slab the selection covers must be the slab being edited.
  if (f.slab !== null && (plane.half ?? frontSlabBit(plane.orientation)) !== f.slab) return false
  // No sub-cell information (shift-lines, fills): any selected part of the cell counts.
  const us = f.su === 2 ? (qu === undefined ? [0, 1] : [qu]) : [0]
  const vs = f.sv === 2 ? (qv === undefined ? [0, 1] : [qv]) : [0]
  return us.some((a) => vs.some((b) => isFineSelected(region, u * f.su + a, v * f.sv + b)))
}

export function forEachFineCell(region: SelectionRegion, cb: (fu: number, fv: number) => void): void {
  const f = region.fine
  if (!f) {
    for (let dv = 0; dv < region.height; dv++) {
      for (let du = 0; du < region.width; du++) {
        if (region.mask[dv * region.width + du] === 1) cb(region.originU + du, region.originV + dv)
      }
    }
    return
  }
  const fw = region.width * f.su
  const fh = region.height * f.sv
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (f.mask[y * fw + x] === 1) cb(region.originU * f.su + x, region.originV * f.sv + y)
    }
  }
}

/** Display-space rect [x0, y0, x1, y1] (display cell units, floats) of one fine cell. */
export function fineDisplayRect(
  plane: ConstructionPlane,
  region: SelectionRegion,
  fu: number,
  fv: number,
): [number, number, number, number] {
  const su = region.fine?.su ?? 1
  const sv = region.fine?.sv ?? 1
  const u = Math.floor(fu / su)
  const v = Math.floor(fv / sv)
  const iu = fu - u * su
  const iv = fv - v * sv
  const mirrorsU = toDisplayU(plane, 0) !== 0
  const mirrorsV = toDisplayV(plane, 0) !== 0
  const x = toDisplayU(plane, u) + (mirrorsU ? su - 1 - iu : iu) / su
  const y = toDisplayV(plane, v) + (mirrorsV ? sv - 1 - iv : iv) / sv
  return [x, y, x + 1 / su, y + 1 / sv]
}

/** Boundary edges of the fine mask in display-space units, for marching ants. */
export function fineOutlineEdges(plane: ConstructionPlane, region: SelectionRegion): Array<[[number, number], [number, number]]> {
  const edges: Array<[[number, number], [number, number]]> = []
  const mirrorsU = toDisplayU(plane, 0) !== 0
  const mirrorsV = toDisplayV(plane, 0) !== 0
  forEachFineCell(region, (fu, fv) => {
    const [x0, y0, x1, y1] = fineDisplayRect(plane, region, fu, fv)
    // Display left/right/up/down neighbours expressed in logical fine units.
    const left = isFineSelected(region, fu + (mirrorsU ? 1 : -1), fv)
    const right = isFineSelected(region, fu + (mirrorsU ? -1 : 1), fv)
    const up = isFineSelected(region, fu, fv + (mirrorsV ? 1 : -1))
    const down = isFineSelected(region, fu, fv + (mirrorsV ? -1 : 1))
    if (!up) edges.push([[x0, y0], [x1, y0]])
    if (!down) edges.push([[x0, y1], [x1, y1]])
    if (!left) edges.push([[x0, y0], [x0, y1]])
    if (!right) edges.push([[x1, y0], [x1, y1]])
  })
  return edges
}

export type { FineSelection }

/** World box (grid units, lower corner + size) of one fine cell of a region made on `plane`. */
export function fineCellWorldBox(
  plane: ConstructionPlane,
  region: SelectionRegion,
  fu: number,
  fv: number,
): { origin: [number, number, number]; size: [number, number, number] } {
  const f = region.fine
  const su = f?.su ?? 1
  const sv = f?.sv ?? 1
  const u = Math.floor(fu / su)
  const v = Math.floor(fv / sv)
  const coord = gridCoordFromPixel(plane, u, v)
  const origin: [number, number, number] = [coord[0], coord[1], coord[2]]
  const size: [number, number, number] = [1, 1, 1]
  const { uDir, vDir } = planeLogicalBasis(plane.axis)
  const uA = uDir[0] !== 0 ? 0 : uDir[1] !== 0 ? 1 : 2
  const vA = vDir[0] !== 0 ? 0 : vDir[1] !== 0 ? 1 : 2
  if (su === 2) {
    size[uA] = 0.5
    origin[uA] += (uDir[uA] > 0 ? fu - u * 2 : 1 - (fu - u * 2)) * 0.5
  }
  if (sv === 2) {
    size[vA] = 0.5
    origin[vA] += (vDir[vA] > 0 ? fv - v * 2 : 1 - (fv - v * 2)) * 0.5
  }
  if (f && f.slab !== null) {
    const wA = axisIndex(plane.axis)
    size[wA] = 0.5
    origin[wA] += f.slab * 0.5
  }
  return { origin, size }
}

/** The voxel and in-voxel box one fine cell of a region made on `plane` covers (the write target). */
export function fineCellBox(plane: ConstructionPlane, region: SelectionRegion, fu: number, fv: number): { coord: Coord; box: CellBox } {
  const { origin, size } = fineCellWorldBox(plane, region, fu, fv)
  const coord: Coord = [Math.floor(origin[0]), Math.floor(origin[1]), Math.floor(origin[2])]
  return { coord, box: boxFromOriginSize([origin[0] - coord[0], origin[1] - coord[1], origin[2] - coord[2]], size) }
}

/** Grid-space bounds (lower / upper corner) of everything a region selects, or null when empty. */
export function fineWorldBounds(plane: ConstructionPlane, region: SelectionRegion): { lo: Coord; hi: Coord } | null {
  const lo: Coord = [Infinity, Infinity, Infinity]
  const hi: Coord = [-Infinity, -Infinity, -Infinity]
  let any = false
  forEachFineCell(region, (fu, fv) => {
    const { origin, size } = fineCellWorldBox(plane, region, fu, fv)
    any = true
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], origin[a])
      hi[a] = Math.max(hi[a], origin[a] + size[a])
    }
  })
  return any ? { lo, hi } : null
}

/** Keys of the whole voxels a region touches, on its plane's slice (the 3D selection's coverage set). */
export function coverageKeys(plane: ConstructionPlane, region: SelectionRegion): CellKey[] {
  const keys: CellKey[] = []
  for (let dv = 0; dv < region.height; dv++) {
    for (let du = 0; du < region.width; du++) {
      if (region.mask[dv * region.width + du] === 1) {
        keys.push(encodeKey(...gridCoordFromPixel(plane, region.originU + du, region.originV + dv)))
      }
    }
  }
  return keys
}

/** A region holding exactly the given fine cells (fine units), for the grid division `div`. */
export function regionFromFineCells(div: FineDivision, cells: ReadonlyArray<readonly [number, number]>): SelectionRegion | null {
  if (cells.length === 0) return null
  const { su, sv } = div
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const [fu, fv] of cells) {
    minU = Math.min(minU, fu)
    maxU = Math.max(maxU, fu)
    minV = Math.min(minV, fv)
    maxV = Math.max(maxV, fv)
  }
  const originU = Math.floor(minU / su)
  const originV = Math.floor(minV / sv)
  const width = Math.floor(maxU / su) - originU + 1
  const height = Math.floor(maxV / sv) - originV + 1
  const cover = new Uint8Array(width * height)
  const fmask = new Uint8Array(width * su * height * sv)
  for (const [fu, fv] of cells) {
    fmask[(fv - originV * sv) * width * su + (fu - originU * su)] = 1
    cover[(Math.floor(fv / sv) - originV) * width + (Math.floor(fu / su) - originU)] = 1
  }
  if (isWholeDivision(div)) return { originU, originV, width, height, mask: cover }
  return { originU, originV, width, height, mask: cover, fine: { su, sv, slab: div.slab, mask: fmask } }
}
