import type { StateCreator } from 'zustand'
import type { AppState, SelectionSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], SelectionSlice>

export const createSelectionSlice: Slice = (set, get) => ({
  selection: null,
  clipboard: null,
  floatContent: null,
  floatOrigin: null,

  // Establishing a genuinely new selection (or deselecting) is a bake trigger (spec: "not write
  // until deselected or selection change") — bake any pending float before switching. Internal
  // float-lifecycle code (liftSelectionToFloat/moveFloatTo/transformFloat/bakeFloatIfAny) updates
  // `state.selection` directly within its own producers instead of calling this action, so it
  // never re-triggers this guard against itself.
  setSelection: (region) => {
    get().bakeFloatIfAny()
    set((state) => { state.selection = region })
  },
  setClipboard: (clipboard) => set((state) => { state.clipboard = clipboard }),
})
