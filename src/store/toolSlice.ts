import type { StateCreator } from 'zustand'
import type { AppState, ToolSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ToolSlice>

export const createToolSlice: Slice = (set) => ({
  activeTool: 'paint',
  activeLayer: 'color',
  activePaletteSlot: { kind: 'base', index: 0 },

  setActiveTool: (tool) => set((state) => { state.activeTool = tool }),
  setActiveLayer: (layer) => set((state) => { state.activeLayer = layer }),
  setActivePaletteSlot: (slot) => set((state) => { state.activePaletteSlot = slot }),
})
