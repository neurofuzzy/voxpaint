import type { GridExtent, VoxelModel } from '@/engine/grid/types'
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
