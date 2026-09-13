import type { StateCreator } from 'zustand'
import { generateNoiseSeed } from '@/engine/ao/bakeAO'
import { decodeSliceKey } from '@/engine/animation/animationLayers'
import {
  clampPlaneOffset,
  decodeKey,
  effectiveExtent,
  emptyModel,
  recomputeBounds,
  withinWorkingBounds,
  DEFAULT_GRID_EXTENT,
  MAX_GRID_EXTENT,
} from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { emptyTextureModel, resizeTextureModel } from '@/engine/texture/TextureStore'
import type { AppState, ProjectSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ProjectSlice>

/** Valid construction-plane offsets for a working cube with the given half-extent. */
function withinSliceRange(offset: number, half: number): boolean {
  return offset >= -half && offset < half
}

export const createProjectSlice: Slice = (set, get) => ({
  model: emptyModel(),
  palette: DEFAULT_PALETTE,
  meta: {
    name: 'Untitled Project',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    gridExtent: DEFAULT_GRID_EXTENT,
    noiseSeed: generateNoiseSeed(),
    voxelScaleY: 1,
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

  setVoxelScaleY: (k) =>
    set((state) => {
      // Only the three offered stops are valid — anything else (e.g. a hand-edited file that
      // slipped past validation) falls back to unit cubes rather than a broken half-state.
      state.meta.voxelScaleY = k === 0.5 || k === 2 ? k : 1
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    }),

  updateProjectSettings: (name, gridExtent) => {
    // Bake any pending floats first so in-bounds work lands in the model before the resize clips.
    get().bakeFloatIfAny()
    get().textureBakeFloatIfAny()
    set((state) => {
      // Same normalization as newProject (odd allowed — the engine works on the even grid above it).
      const extent = Math.max(2, Math.min(MAX_GRID_EXTENT, Math.round(gridExtent)))
      const prevExtent = state.meta.gridExtent
      state.meta.name = name || 'Untitled Project'
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
      if (extent === prevExtent) return // rename only — everything else stays put

      // Clip voxels outside the new working cube (chamfer cells always have a matching color
      // cell, so deleting by color key drops both layers together).
      for (const key of state.model.color.keys()) {
        if (!withinWorkingBounds(decodeKey(key), extent)) {
          state.model.color.delete(key)
          state.model.chamfer.delete(key)
        }
      }
      state.model.bounds = recomputeBounds(state.model)
      state.meta.gridExtent = extent

      // Re-house the texture faces (center-crop on shrink, EMPTY-pad on grow).
      state.texture = resizeTextureModel(state.texture, prevExtent, extent)

      // Position-dependent state can't survive a bounds change: clear histories, selections,
      // and pending floats (already baked above), prune animation slices outside the new range,
      // and clamp the construction plane back into it.
      state.past = []
      state.future = []
      state.texturePast = []
      state.textureFuture = []
      state.animPast = []
      state.animFuture = []
      state.selection = null
      state.floatContent = null
      state.floatOrigin = null
      state.textureSelection = null
      state.textureFloat = null
      state.textureFloatOrigin = null
      state.objectModeTarget = null
      const half = effectiveExtent(extent) / 2
      state.plane.offset = clampPlaneOffset(state.plane.offset, extent)
      for (const key of state.animSettings.keys()) {
        if (!withinSliceRange(decodeSliceKey(key).offset, half)) state.animSettings.delete(key)
      }
      for (const key of state.sliceMasks.keys()) {
        if (!withinSliceRange(decodeSliceKey(key).offset, half)) state.sliceMasks.delete(key)
      }
      for (const [key, cellKey] of state.slicePivots) {
        const { offset } = decodeSliceKey(key)
        if (!withinSliceRange(offset, half) || !withinWorkingBounds(decodeKey(cellKey), extent)) {
          state.slicePivots.delete(key)
        }
      }
    })
  },

  randomizeNoiseSeed: () =>
    set((state) => {
      state.meta.noiseSeed = generateNoiseSeed()
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    }),

  newProject: (name, gridExtent) => {
    // A pending float holds an open undo stroke against the OLD model — discard the float and
    // abandon all three strokes rather than baking, so no stale baseline leaks into the fresh
    // project's histories.
    get().cancelStroke()
    get().textureCancelStroke()
    get().animCancelStroke()
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
        voxelScaleY: 1,
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
      state.exportIncludeTextureMaps = true
      state.animSettings = new Map()
      state.sliceMasks = new Map()
      state.slicePivots = new Map()
      state.animPast = []
      state.animFuture = []
      state.dirty = true
      // A stale plane offset from a larger project would start out of bounds — pull it back in.
      // (Axis/orientation carry over; only the offset is range-bound.)
      state.plane.offset = clampPlaneOffset(state.plane.offset, extent)
      state.objectModeTarget = null
      // View/tool prefs (active tool, palette slot, plane axis) carry over deliberately — but a
      // stale voxel selection would clip painting on the fresh canvas via an invisible mask, and
      // hover state references dead cells, so both reset. (Clipboards are kept: pasting across
      // projects is safe — paste clips to the new bounds.)
      state.selection = null
      state.floatContent = null
      state.floatOrigin = null
      state.hoverCell = null
      state.chamferHoverValid = null
      state.hoveredFace = null
    })
  },
})
