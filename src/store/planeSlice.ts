import type { StateCreator } from 'zustand'
import type { AppState, PlaneSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PlaneSlice>

export const createPlaneSlice: Slice = (set, get) => ({
  plane: { axis: 'z', orientation: 1, offset: 0 },
  objectModeTarget: null,

  // A pending float's cells are offsets interpreted against the plane active at lift/bake time —
  // switching planes out from under it would bake it onto the wrong 3D cells, so bake first.
  setPlaneAxisOrientation: (axis, orientation) => {
    get().bakeFloatIfAny()
    set((state) => {
      state.plane.axis = axis
      state.plane.orientation = orientation
      // Any plane change not driven by handleVoxelFaceClick's own logic invalidates the
      // same-voxel-click-again target (the highlighted face no longer corresponds to it).
      state.objectModeTarget = null
    })
  },

  setPlaneOffset: (offset) => {
    get().bakeFloatIfAny()
    set((state) => {
      state.plane.offset = offset
      state.objectModeTarget = null
    })
  },

  handleVoxelFaceClick: (cellKey, axis, orientation, offset) => {
    const current = get().objectModeTarget
    // "Again" means the exact same face, not just the same voxel — a click on a different face
    // of the same voxel must switch the plane to that new face, not advance along the old one.
    if (current && current.cellKey === cellKey && current.axis === axis && current.orientation === orientation) {
      // Second click on the same face: advance one step forward through it.
      get().setPlaneOffset(current.offset + current.orientation)
      return
    }
    get().setPlaneAxisOrientation(axis, orientation)
    get().setPlaneOffset(offset)
    set((state) => {
      state.objectModeTarget = { cellKey, axis, orientation, offset }
    })
  },
})
