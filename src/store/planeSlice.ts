import type { StateCreator } from 'zustand'
import type { AppState, PlaneSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PlaneSlice>

export const createPlaneSlice: Slice = (set, get) => ({
  plane: { axis: 'z', orientation: 1, offset: 0 },

  // A pending float's cells are offsets interpreted against the plane active at lift/bake time —
  // switching planes out from under it would bake it onto the wrong 3D cells, so bake first.
  setPlaneAxisOrientation: (axis, orientation) => {
    get().bakeFloatIfAny()
    set((state) => {
      state.plane.axis = axis
      state.plane.orientation = orientation
    })
  },

  setPlaneOffset: (offset) => {
    get().bakeFloatIfAny()
    set((state) => {
      state.plane.offset = offset
    })
  },
})
