import type { StateCreator } from 'zustand'
import { emptyModel } from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { AppState, ProjectSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ProjectSlice>

export const createProjectSlice: Slice = (set) => ({
  model: emptyModel(),
  palette: DEFAULT_PALETTE,
  meta: {
    name: 'Untitled Project',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  },

  setModel: (model) =>
    set((state) => {
      state.model = model
      state.meta.modifiedAt = new Date().toISOString()
    }),

  setPalette: (palette) => set((state) => { state.palette = palette }),

  newProject: () =>
    set((state) => {
      state.model = emptyModel()
      state.palette = DEFAULT_PALETTE
      state.meta = {
        name: 'Untitled Project',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      }
      state.past = []
      state.future = []
    }),
})
