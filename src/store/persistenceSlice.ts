import type { StateCreator } from 'zustand'
import type { AppState, PersistenceSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PersistenceSlice>

export const createPersistenceSlice: Slice = (set) => ({
  dirty: false,
  lastSavedAt: null,
  lastError: null,
  currentFilePath: null,

  markDirty: () => set((state) => { state.dirty = true }),
  markSaved: (at) =>
    set((state) => {
      state.dirty = false
      state.lastSavedAt = at
      state.lastError = null
    }),
  setError: (message) => set((state) => { state.lastError = message }),
  setCurrentFilePath: (path) => set((state) => { state.currentFilePath = path }),
})
