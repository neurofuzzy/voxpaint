import type { StateCreator } from 'zustand'
import type { AppState, ViewSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ViewSlice>

export const createViewSlice: Slice = (set) => ({
  fullscreen: false,
  hoverCell: null,
  chamferHoverValid: null,
  hoveredFace: null,

  setFullscreen: (v) => set((state) => { state.fullscreen = v }),
  setHoverCell: (coord, chamferValid) =>
    set((state) => {
      state.hoverCell = coord
      state.chamferHoverValid = chamferValid
    }),
  setHoveredFace: (face) => set((state) => { state.hoveredFace = face }),
})
