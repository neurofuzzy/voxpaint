import type { StateCreator } from 'zustand'
import { generateNoiseSeed } from '@/engine/ao/bakeAO'
import { emptyModel, DEFAULT_GRID_EXTENT, MAX_GRID_EXTENT } from '@/engine/grid/GridStore'
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
    gridExtent: DEFAULT_GRID_EXTENT,
    noiseSeed: generateNoiseSeed(),
  },

  setModel: (model) =>
    set((state) => {
      state.model = model
      state.meta.modifiedAt = new Date().toISOString()
    }),

  setPalette: (palette) => set((state) => { state.palette = palette }),

  applyPaletteTheme: (palette) =>
    set((state) => {
      state.palette.base = [...palette.base]
      state.palette.emissive = [...palette.emissive]
      state.palette.metal = [...palette.metal]
      state.palette.glass = [...palette.glass]
      // emissiveAnim intentionally untouched — a theme swaps colors, not the user's blink/pulse config.
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    }),

  setEmissiveAnimMode: (index, mode) =>
    set((state) => {
      state.palette.emissiveAnim[index] = mode
      state.dirty = true
    }),

  setProjectName: (name) =>
    set((state) => {
      state.meta.name = name
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    }),

  randomizeNoiseSeed: () =>
    set((state) => {
      state.meta.noiseSeed = generateNoiseSeed()
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    }),

  newProject: (name, gridExtent) =>
    set((state) => {
      // Defensively normalize any custom size to a whole edge length within the technical range
      // (odd is allowed — the engine rounds it up to an even working grid via `effectiveExtent`).
      const extent = Math.max(2, Math.min(MAX_GRID_EXTENT, Math.round(gridExtent)))
      state.model = emptyModel()
      state.palette = DEFAULT_PALETTE
      state.meta = {
        name: name || 'Untitled Project',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        gridExtent: extent,
        noiseSeed: generateNoiseSeed(),
      }
      state.past = []
      state.future = []
      // Reset the parallel texture stack too, so a new project starts fully blank.
      state.texture = emptyTextureModel(extent)
      state.texturePast = []
      state.textureFuture = []
      state.textureSelection = null
      state.textureFloat = null
      state.textureFloatOrigin = null
      state.activeBoxFace = null
      state.noiseLevel = 0
      state.specularNoiseLevel = 0
      state.aoStrength = 1
      state.exportScaleFactor = 100
      state.exportAnchor = 'center'
      state.animSettings = new Map()
      state.sliceMasks = new Map()
      state.slicePivots = new Map()
      state.animPast = []
      state.animFuture = []
      state.dirty = true
    }),
})
