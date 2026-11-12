import type { Axis, Orientation } from '@/engine/grid/types'

export type ConstructionPlane = {
  axis: Axis
  orientation: Orientation
  offset: number
  /**
   * Half-voxel stop (null = whole-voxel stop). A world-axis bit picking which depth half of the
   * slice the plane sits on: `[offset, offset+0.5)` for 0, `[offset+0.5, offset+1)` for 1.
   * Non-null exactly when the armed grid cuts the plane's axis (`snapPlaneToGrid` keeps the two
   * in step); edits on a half stop write that slab of each voxel (see `gridBox`). Plain voxels
   * are as editable as subdivided ones — the write splits them as needed.
   */
  half: 0 | 1 | null
}
