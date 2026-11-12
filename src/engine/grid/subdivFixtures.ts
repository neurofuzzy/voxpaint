import { encodeKey } from './GridStore'
import type { Coord, DetailChild, SplitAxis, VoxelModel } from './types'

/**
 * Test fixtures only — raw detail writes that bypass `writeBox`'s normalization, for building
 * exact subdivision states (including ones real edits would fold away) in tests. App code must
 * write through `engine/grid/cellBox.ts`.
 */

/** Sets child `index` of the subdivided voxel at `coord` verbatim. Returns false if not subdivided. */
export function setDetailChild(model: VoxelModel, coord: Coord, index: number, child: DetailChild | null): boolean {
  const sub = model.subdiv.get(encodeKey(...coord))
  if (!sub || index < 0 || index >= sub.children.length) return false
  sub.children[index] = child ? { slot: child.slot, ...(child.chamfer ? { chamfer: { ...child.chamfer, resolvedTo: child.chamfer.resolvedTo ? { ...child.chamfer.resolvedTo } : null } } : {}) } : null
  return true
}

/** Splits empty space into an all-empty subdivision (an unnormalized state). */
export function emptyDetailAt(model: VoxelModel, coord: Coord, split: SplitAxis[]): void {
  const key = encodeKey(...coord)
  model.color.delete(key)
  model.chamfer.delete(key)
  model.subdiv.set(key, { split: [...split].sort() as SplitAxis[], children: Array.from({ length: 2 ** split.length }, () => null) })
}
