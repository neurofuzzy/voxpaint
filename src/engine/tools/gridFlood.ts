import { encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import { childOverlapsBox, frontSlabBit, planeFrame, recolorBox, writeBox, type CellBox } from '@/engine/grid/cellBox'
import type { Coord, GridExtent, SplitAxis, VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'

/**
 * Flood fills at the armed grid's resolution. A **unit** is one cell of the grid: per world axis
 * the voxel is cut in two when the grid cuts that axis, so unit coords are `cell * res + bit`
 * (res 1 or 2 per axis). The whole grid is res 1 everywhere — one unit per voxel, the classic
 * whole-voxel fill. A unit's "colour" is the set of slots of the content overlapping it (chamfer
 * voxels count as their slot — fills recolor, never reshape); a unit no content overlaps is empty.
 * A unit only partly filled (content finer than the grid) is not empty, so it walls an empty fill.
 */

export type Unit = [number, number, number]
export type GridRes = [1 | 2, 1 | 2, 1 | 2]

const AXES: SplitAxis[] = ['x', 'y', 'z']

/** Units per voxel along each world axis under `grid`. */
export function gridRes(grid: readonly SplitAxis[] | null): GridRes {
  return AXES.map((a) => (grid?.includes(a) ? 2 : 1)) as GridRes
}

/** The voxel and in-voxel box a unit covers. */
export function unitBox(res: GridRes, unit: Unit): { cell: Coord; box: CellBox } {
  const cell = unit.map((n, i) => Math.floor(n / res[i])) as Coord
  const box = unit.map((n, i) => (res[i] === 2 ? ((n - cell[i] * 2) as 0 | 1) : null)) as CellBox
  return { cell, box }
}

/** Colour of a unit (sorted slot set), or null when nothing overlaps it. */
export function unitColor(model: VoxelModel, res: GridRes, unit: Unit): string | null {
  const { cell, box } = unitBox(res, unit)
  const key = encodeKey(...cell)
  const slotKey = (s: PaletteSlotRef) => `${s.kind}:${s.index}`
  const sub = model.subdiv.get(key)
  if (!sub) {
    const c = model.color.get(key)
    return c ? slotKey(c.paletteSlot) : null
  }
  const found = new Set<string>()
  sub.children.forEach((child, i) => {
    if (child && childOverlapsBox(sub.split, i, box)) found.add(slotKey(child.slot))
  })
  return found.size === 0 ? null : [...found].sort().join('|')
}

/** The unit containing a voxel plus in-voxel world half-bits (null bits → the low unit). */
export function unitAt(res: GridRes, cell: Coord, bits: Coord | null): Unit {
  return cell.map((c, i) => c * res[i] + (res[i] === 2 ? (bits?.[i] ?? 0) : 0)) as Unit
}

/**
 * The unit a plane-targeted pointer addresses: the cell plus the pointer's in-plane half-bits
 * (world bits, or null for the low half), at the plane's slab along the plane axis when the grid
 * cuts it (the viewer-side slab on a whole stop).
 */
export function planeUnitAt(res: GridRes, plane: ConstructionPlane, cell: Coord, inPlaneBits: Coord | null): Unit {
  const { wA } = planeFrame(plane.axis)
  const unit = unitAt(res, cell, inPlaneBits)
  if (res[wA] === 2) unit[wA] = cell[wA] * 2 + (plane.half ?? frontSlabBit(plane.orientation))
  else unit[wA] = cell[wA]
  return unit
}

const key3 = (u: Unit) => `${u[0]},${u[1]},${u[2]}`

/**
 * 4-connected fill over the plane's slab at grid resolution, from `start`: every unit of the same
 * colour (or every empty unit, from an empty start), inside the working box and `within`.
 */
export function floodPlanarUnits(
  model: VoxelModel,
  plane: ConstructionPlane,
  res: GridRes,
  start: Unit,
  gridExtent: GridExtent,
  within?: (unit: Unit) => boolean,
): Unit[] {
  const { uA, vA } = planeFrame(plane.axis)
  const target = unitColor(model, res, start)
  const ok = (u: Unit) => withinWorkingBounds(unitBox(res, u).cell, gridExtent) && (!within || within(u)) && unitColor(model, res, u) === target
  if (!ok(start)) return []
  const seen = new Set<string>([key3(start)])
  const out: Unit[] = [start]
  for (let i = 0; i < out.length; i++) {
    for (const [axis, d] of [[uA, 1], [uA, -1], [vA, 1], [vA, -1]] as const) {
      const n = [...out[i]] as Unit
      n[axis] += d
      const k = key3(n)
      if (seen.has(k)) continue
      seen.add(k)
      if (ok(n)) out.push(n)
    }
  }
  return out
}

/**
 * 6-connected fill through the volume at grid resolution, from an occupied `start`: `color` takes
 * every unit of the start's colour, `occupied` every non-empty unit (the touching component).
 */
export function floodVolumeUnits(model: VoxelModel, res: GridRes, start: Unit, mode: 'color' | 'occupied', gridExtent: GridExtent): Unit[] {
  const target = unitColor(model, res, start)
  if (target === null) return []
  const ok = (u: Unit) => {
    if (!withinWorkingBounds(unitBox(res, u).cell, gridExtent)) return false
    const c = unitColor(model, res, u)
    return c !== null && (mode === 'occupied' || c === target)
  }
  const seen = new Set<string>([key3(start)])
  const out: Unit[] = [start]
  for (let i = 0; i < out.length; i++) {
    for (let axis = 0; axis < 3; axis++) {
      for (const d of [1, -1]) {
        const n = [...out[i]] as Unit
        n[axis] += d
        const k = key3(n)
        if (seen.has(k)) continue
        seen.add(k)
        if (ok(n)) out.push(n)
      }
    }
  }
  return out
}

/** Paints empty units and recolors filled ones (fills never reshape). Mutates the (draft) model. */
export function fillUnits(model: VoxelModel, res: GridRes, units: readonly Unit[], slot: PaletteSlotRef): void {
  for (const u of units) {
    const { cell, box } = unitBox(res, u)
    if (unitColor(model, res, u) === null) writeBox(model, cell, box, { slot })
    else recolorBox(model, cell, box, slot)
  }
}

/** Plane (u,v) cells the units lie in, deduped — for the edge-leak guard and whole-cell masks. */
export function unitPlaneCells(plane: ConstructionPlane, res: GridRes, units: readonly Unit[]): Array<[number, number]> {
  const seen = new Set<string>()
  const out: Array<[number, number]> = []
  for (const u of units) {
    const { cell } = unitBox(res, u)
    const { u: pu, v: pv } = pixelFromGridCoord(plane, cell)
    const k = `${pu},${pv}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push([pu, pv])
  }
  return out
}

/** The logical in-plane quadrant a unit sits in on `plane` (undefined along axes the grid doesn't cut). */
export function unitQuadrant(plane: ConstructionPlane, res: GridRes, unit: Unit): { qu?: number; qv?: number } {
  const { uA, vA, uPos, vPos } = planeFrame(plane.axis)
  const { box } = unitBox(res, unit)
  const bu = box[uA]
  const bv = box[vA]
  return {
    ...(bu === null ? {} : { qu: uPos ? bu : 1 - bu }),
    ...(bv === null ? {} : { qv: vPos ? bv : 1 - bv }),
  }
}
