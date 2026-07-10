import type { StateCreator } from 'zustand'
import type { AppState, PlaneSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PlaneSlice>

export const createPlaneSlice: Slice = (set) => ({
  plane: { axis: 'z', orientation: 1, offset: 0 },

  setPlaneAxisOrientation: (axis, orientation) =>
    set((state) => {
      state.plane.axis = axis
      state.plane.orientation = orientation
    }),

  setPlaneOffset: (offset) =>
    set((state) => {
      state.plane.offset = offset
    }),
})
