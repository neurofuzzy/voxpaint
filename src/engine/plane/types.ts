import type { Axis, Orientation } from '@/engine/grid/types'

export type ConstructionPlane = {
  axis: Axis
  orientation: Orientation
  offset: number
  /**
   * Half-step slab selector (null = whole-voxel mode). A world-axis bit selecting which depth
   * half of the slice's voxels is editable: `[offset, offset+0.5)` for 0,
   * `[offset+0.5, offset+1)` for 1. Only subdivided voxels are editable while set —
   * whole-cube writes would straddle slabs. Set by tapping a subdivided voxel's face in the
   * 3D view; cleared by tapping a plain voxel, reorienting, or advancing the plane.
   */
  half: 0 | 1 | null
}
