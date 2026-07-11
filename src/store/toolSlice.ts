import type { StateCreator } from 'zustand'
import type { AppState, ToolSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ToolSlice>

export const createToolSlice: Slice = (set) => ({
  activeTool: 'paint',
  activeVoxelKind: 'cube',
  activePaletteSlot: { kind: 'base', index: 0 },

  setActiveTool: (tool) => set((state) => { state.activeTool = tool }),
  setActiveVoxelKind: (kind) => set((state) => { state.activeVoxelKind = kind }),
  setActivePaletteSlot: (slot) => set((state) => { state.activePaletteSlot = slot }),
})
