import type { StateCreator } from 'zustand'
import type { AppState, ViewSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ViewSlice>

export const createViewSlice: Slice = (set) => ({
  fullscreen: false,
  hoverCell: null,
  chamferHoverValid: null,
  hoveredFace: null,
  wireframe: false,
  optimizedMesh: false,
  statusMessage: null,
  onionSkin: true,

  setFullscreen: (v) => set((state) => { state.fullscreen = v }),
  setWireframe: (v) => set((state) => { state.wireframe = v }),
  setOptimizedMesh: (v) => set((state) => { state.optimizedMesh = v }),
  setHoverCell: (coord, chamferValid) =>
    set((state) => {
      state.hoverCell = coord
      state.chamferHoverValid = chamferValid
    }),
  setHoveredFace: (face) => set((state) => { state.hoveredFace = face }),
  setStatusMessage: (msg) => set((state) => { state.statusMessage = msg }),
  setOnionSkin: (v) => set((state) => { state.onionSkin = v }),
})
