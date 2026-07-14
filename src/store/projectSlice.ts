import type { StateCreator } from 'zustand'
import { emptyModel } from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
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
      // Reset the parallel texture stack too, so a new project starts fully blank.
      state.texture = emptyTextureModel()
      state.texturePast = []
      state.textureFuture = []
      state.textureSelection = null
      state.textureFloat = null
      state.textureFloatOrigin = null
      state.activeBoxFace = null
      state.noiseLevel = 0
      state.aoStrength = 1
    }),
})
