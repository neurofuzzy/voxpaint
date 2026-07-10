import type { StateCreator } from 'zustand'
import type { AppState, SelectionSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], SelectionSlice>

export const createSelectionSlice: Slice = (set) => ({
  selection: null,
  clipboard: null,

  setSelection: (region) => set((state) => { state.selection = region }),
  setClipboard: (clipboard) => set((state) => { state.clipboard = clipboard }),
})
