import { withinWorkingBounds } from '@/engine/grid/GridStore'
import { encodeKey } from '@/engine/grid/GridStore'
import type { GridExtent, SplitAxis, VoxelModel } from '@/engine/grid/types'
import { splitChildBits } from '@/engine/grid/subdiv'
import { gridCoordFromPixel, planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import { worldAxisOf, forEachFineCell, type FineDivision } from './fineSelection'
import type { SelectionRegion } from '@/store/types'

/**
 * The sub-voxel wand: flood-selects fine cells (the grid's resolution) on the active plane slice.
 * A fine cell's "colour" is the set of slots of the voxel parts covering it; empty parts are not
 * selectable. `color` mode floods cells with the same colour; `occupied` floods any filled cell.
 * Chamfer voxels are atomic and count as their own colour.
 */
export function fineCellColor(model: VoxelModel, plane: ConstructionPlane, div: FineDivision, fu: number, fv: number, gridExtent: GridExtent): string | null {
  const u = Math.floor(fu / div.su)
  const v = Math.floor(fv / div.sv)
  const coord = gridCoordFromPixel(plane, u, v)
  if (!withinWorkingBounds(coord, gridExtent)) return null
  const key = encodeKey(...coord)
  const slotKey = (s: { kind: string; index: number }) => `${s.kind}:${s.index}`
  const sub = model.subdiv.get(key)
  if (!sub) {
    const c = model.color.get(key)
    if (!c) return null
    return slotKey(c.paletteSlot) + (model.chamfer.has(key) ? '#chamfer' : '')
  }
  const { uDir, vDir } = planeLogicalBasis(plane.axis)
  const uAxis = worldAxisOf(uDir)
  const vAxis = worldAxisOf(vDir)
  const wAxis = (['x', 'y', 'z'] as SplitAxis[])[axisIndex(plane.axis)]
  const iu = fu - u * div.su
  const iv = fv - v * div.sv
  const found = new Set<string>()
  sub.children.forEach((child, o) => {
    if (!child) return
    const bits = splitChildBits(sub.split, o)
    const bit = { x: bits[0], y: bits[1], z: bits[2] }
    if (div.su === 2 && sub.split.includes(uAxis) && (uDir[axisIndex(uAxis)] > 0 ? bit[uAxis] : 1 - bit[uAxis]) !== iu) return
    if (div.sv === 2 && sub.split.includes(vAxis) && (vDir[axisIndex(vAxis)] > 0 ? bit[vAxis] : 1 - bit[vAxis]) !== iv) return
    if (div.slab !== null && sub.split.includes(wAxis) && bit[wAxis] !== div.slab) return
    found.add(slotKey(child.slot) + (child.chamfer ? '#chamfer' : ''))
  })
  return found.size === 0 ? null : [...found].sort().join('|')
}

export function floodFineCells(
  model: VoxelModel,
  plane: ConstructionPlane,
  div: FineDivision,
  start: readonly [number, number],
  mode: 'color' | 'occupied',
  gridExtent: GridExtent,
): Array<[number, number]> {
  const target = fineCellColor(model, plane, div, start[0], start[1], gridExtent)
  if (target === null) return []
  const seen = new Set<string>([`${start[0]},${start[1]}`])
  const out: Array<[number, number]> = [[start[0], start[1]]]
  for (let i = 0; i < out.length; i++) {
    const [fu, fv] = out[i]
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nu = fu + du
      const nv = fv + dv
      const k = `${nu},${nv}`
      if (seen.has(k)) continue
      seen.add(k)
      const c = fineCellColor(model, plane, div, nu, nv, gridExtent)
      if (c === null) continue
      if (mode === 'color' && c !== target) continue
      out.push([nu, nv])
    }
  }
  return out
}

/**
 * True when a sub-voxel selection covers any chamfered part (a beveled detail child or a
 * chamfer cell, both of which ride along atomically). A lifted float with chamfered content
 * moves in whole voxels only, so the select tool records this at lift time — the content it
 * lifts may not be visible in its own context yet.
 */
export function selectionTouchesChamfer(
  model: VoxelModel,
  plane: ConstructionPlane,
  region: SelectionRegion,
  gridExtent: GridExtent,
): boolean {
  const f = region.fine
  if (!f) return false
  const div: FineDivision = { su: f.su, sv: f.sv, slab: f.slab }
  let hit = false
  forEachFineCell(region, (fu, fv) => {
    if (hit) return
    if ((fineCellColor(model, plane, div, fu, fv, gridExtent) ?? '').includes('#chamfer')) hit = true
  })
  return hit
}
