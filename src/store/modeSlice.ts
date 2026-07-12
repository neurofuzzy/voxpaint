import type { StateCreator } from 'zustand'
import type { AppState, ModeSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ModeSlice>

/**
 * The single top-level authoring-mode switch. Everything that differs between voxel modeling and
 * texture painting keys off `mode` — canvas, 3D preview, palette, undo/redo dispatch — so mode
 * awareness stays at component boundaries (whole-subtree gating) instead of being sprinkled through
 * the code.
 */
export const createModeSlice: Slice = (set) => ({
  mode: 'model',
  setMode: (mode) => set((state) => { state.mode = mode }),
})
