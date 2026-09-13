import type { CellKey, Coord, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'

function slotsEqual(a: PaletteSlotRef | undefined, b: PaletteSlotRef | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.kind === b.kind && a.index === b.index
}

/**
 * 4-connected flood fill over the active plane's (u,v) slice, color layer only (spec §2 —
 * chamfer fill is excluded). Bounded to the plane's displayed span and the model's 64^3 growth
 * cap. Returns the (u,v) cells to recolor; painting is left to the caller so it can run inside
 * one Immer producer/undo stroke.
 */
export function floodFillRegion(
  model: VoxelModel,
  plane: ConstructionPlane,
  startU: number,
  startV: number,
  gridExtent: GridExtent,
): Array<[number, number]> {
  const half = gridExtent / 2
  const inSpan = (u: number, v: number) => u >= -half && u < half && v >= -half && v < half
  const colorAt = (u: number, v: number) => model.color.get(encodeKey(...gridCoordFromPixel(plane, u, v)))?.paletteSlot

  const target = colorAt(startU, startV)
  const visited = new Set<string>()
  const stack: Array<[number, number]> = [[startU, startV]]
  const result: Array<[number, number]> = []

  while (stack.length > 0) {
    const [u, v] = stack.pop()!
    const key = `${u},${v}`
    if (visited.has(key)) continue
    visited.add(key)
    if (!inSpan(u, v)) continue
    if (!slotsEqual(colorAt(u, v), target)) continue

    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, gridExtent)) continue

    result.push([u, v])
    stack.push([u + 1, v], [u - 1, v], [u, v + 1], [u, v - 1])
  }

  return result
}

/**
 * True when a flood-fill result touches all 4 edges of the plane's displayed span — the usual
 * sign that the region wasn't actually enclosed (a gap let it spill across the whole plane)
 * rather than a deliberate edge-to-edge fill. Callers use this to reject the fill outright.
 */
export function fillLeaksToEdges(cells: Array<[number, number]>, gridExtent: GridExtent): boolean {
  const half = gridExtent / 2
  let touchesMinU = false, touchesMaxU = false, touchesMinV = false, touchesMaxV = false
  for (const [u, v] of cells) {
    if (u === -half) touchesMinU = true
    if (u === half - 1) touchesMaxU = true
    if (v === -half) touchesMinV = true
    if (v === half - 1) touchesMaxV = true
  }
  return touchesMinU && touchesMaxU && touchesMinV && touchesMaxV
}

/**
 * 6-connected flood fill through the full 3D VoxelModel (not just one plane), color layer only —
 * same chamfer-preserving rule as `floodFillRegion`. Only ever called from an already-occupied
 * starting cell (the fill tool's alt-click requires clicking an existing voxel), so `target` is
 * always a real palette slot, never "empty".
 */
export function floodFillRegion3D(model: VoxelModel, start: Coord, gridExtent: GridExtent): CellKey[] {
  const target = model.color.get(encodeKey(...start))?.paletteSlot
  const visited = new Set<CellKey>()
  const stack: Coord[] = [start]
  const result: CellKey[] = []

  while (stack.length > 0) {
    const coord = stack.pop()!
    const key = encodeKey(...coord)
    if (visited.has(key)) continue
    visited.add(key)
    if (!withinWorkingBounds(coord, gridExtent)) continue
    if (!slotsEqual(model.color.get(key)?.paletteSlot, target)) continue

    result.push(key)
    const [x, y, z] = coord
    stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1])
  }

  return result
}
