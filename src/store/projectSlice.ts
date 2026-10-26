import type { StateCreator } from 'zustand'
import { generateNoiseSeed } from '@/engine/ao/bakeAO'
import { decodeSliceKey, encodeSliceKey } from '@/engine/animation/animationLayers'
import {
  clampPlaneOffset,
  decodeKey,
  effectiveExtent,
  emptyModel,
  encodeKey,
  recomputeBounds,
  withinWorkingBounds,
  DEFAULT_GRID_EXTENT,
  MAX_GRID_EXTENT,
} from '@/engine/grid/GridStore'
import { RESCALE_FACTOR, rescaleCoord, rescaleTargetExtent, rescaleVoxelModel } from '@/engine/grid/rescale'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { savePlanePref } from '@/engine/persistence/uiPrefs'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { TEXEL_SCALE } from '@/engine/texture/types'
import { emptyTextureModel, normalizeTexelScale, resampleTextureModel, rescaleTextureModel2x, resizeTextureModel } from '@/engine/texture/TextureStore'
import type { TexelScale } from '@/engine/texture/types'
import type { CellKey } from '@/engine/grid/types'
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
    texelScale: TEXEL_SCALE,
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

  setTexelScale: (scale: TexelScale) => {
    const next = normalizeTexelScale(scale)
    get().textureBakeFloatIfAny()
    const prev = normalizeTexelScale(get().meta.texelScale ?? TEXEL_SCALE)
    if (next === prev) return
    // Bracketed as one texture-undo step (the baseline carries the old faces + old scale), so
    // the change is undoable — redo included. The voxel model itself is untouched, so its
    // history stays.
    get().textureBeginStroke()
    set((state) => {
      state.texture = resampleTextureModel(state.texture, state.meta.gridExtent, prev, next)
      state.meta.texelScale = next
      // Masks/origins are texel-indexed for one size — drop them rather than clip through them.
      state.textureSelection = null
      state.textureFloat = null
      state.textureFloatOrigin = null
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().textureCommitStroke()
  },

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
      state.texture = resizeTextureModel(
        state.texture,
        prevExtent,
        extent,
        normalizeTexelScale(state.meta.texelScale ?? TEXEL_SCALE),
      )

      // Markers are position-dependent too — drop any outside the new bounds.
      state.markers = state.markers.filter((m) => withinWorkingBounds(m.position, extent))
      if (state.selectedMarkerId && !state.markers.some((m) => m.id === state.selectedMarkerId)) {
        state.selectedMarkerId = null
      }

      // Rig boxes are model-decoupled but grid-bound — clamp into the new working cube,
      // dropping boxes with nothing left inside. Children of dropped boxes move up to the
      // nearest surviving ancestor (or root).
      {
        const half = effectiveExtent(extent) / 2
        const lo = -half
        const hi = half - 1
        const clamp = (v: number) => Math.max(lo, Math.min(hi, v))
        const parentOf = new Map(state.rigBoxes.map((b) => [b.id, b.parentId]))
        state.rigBoxes = state.rigBoxes
          .map((b) => ({
            ...b,
            min: [clamp(Math.min(b.min[0], b.max[0])), clamp(Math.min(b.min[1], b.max[1])), clamp(Math.min(b.min[2], b.max[2]))] as [number, number, number],
            max: [clamp(Math.max(b.min[0], b.max[0])), clamp(Math.max(b.min[1], b.max[1])), clamp(Math.max(b.min[2], b.max[2]))] as [number, number, number],
          }))
          .filter((b) => b.min[0] <= b.max[0] && b.min[1] <= b.max[1] && b.min[2] <= b.max[2])
        const surviving = new Set(state.rigBoxes.map((b) => b.id))
        for (const b of state.rigBoxes) {
          let p = b.parentId
          while (p && !surviving.has(p)) p = parentOf.get(p) ?? null
          b.parentId = p
        }
        if (state.selectedRigBoxId && !surviving.has(state.selectedRigBoxId)) {
          state.selectedRigBoxId = null
        }
      }

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
      state.selectedCells = new Set<CellKey>()
      state.floatContent = null
      state.floatOrigin = null
      state.textureSelection = null
      state.textureFloat = null
      state.textureFloatOrigin = null
      state.objectModeTarget = null
      state.paintLineAnchor = null
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
    // A resize can clamp the offset — persist the pose it settled on.
    savePlanePref(get().plane)
  },

  rescaleProject: () => {
    // Bake any pending floats first so in-bounds work lands in the model before it doubles.
    get().bakeFloatIfAny()
    get().textureBakeFloatIfAny()
    const prevExtent = get().meta.gridExtent
    const extent = rescaleTargetExtent(prevExtent)
    // The menu disables this entry past the cap; the guard is defensive (clamping would silently
    // produce a wrong scale, so a no-op is the only safe fallback).
    if (extent > MAX_GRID_EXTENT) return
    set((state) => {
      state.model = rescaleVoxelModel(state.model)
      state.meta.gridExtent = extent
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true

      // Texture paint doubles with the voxels (nearest-neighbor, glued by world position).
      state.texture = rescaleTextureModel2x(
        state.texture,
        prevExtent,
        extent,
        normalizeTexelScale(state.meta.texelScale ?? TEXEL_SCALE),
      )

      // Markers double about the origin with everything else (frozen facing basis untouched).
      for (const m of state.markers) {
        m.position = [RESCALE_FACTOR * m.position[0], RESCALE_FACTOR * m.position[1], RESCALE_FACTOR * m.position[2]]
      }

      // Rig boxes double with the voxels: inclusive [min, max] → [2*min, 2*max+1].
      for (const b of state.rigBoxes) {
        b.min = [RESCALE_FACTOR * b.min[0], RESCALE_FACTOR * b.min[1], RESCALE_FACTOR * b.min[2]]
        b.max = [RESCALE_FACTOR * b.max[0] + 1, RESCALE_FACTOR * b.max[1] + 1, RESCALE_FACTOR * b.max[2] + 1]
      }

      // Animation slices fan out: old slice o becomes new slices 2o/2o+1. Settings clone onto
      // both (later edits must not alias); mask cells expand to their 8 children, grouped by
      // the new slice each child lands in; pivots map to the min-corner child in both slices.
      const animSettings = new Map()
      for (const [sliceKey, settings] of state.animSettings) {
        const { axis, offset } = decodeSliceKey(sliceKey)
        for (const doubled of rescaleCoord(offset)) {
          animSettings.set(encodeSliceKey(axis, doubled), { ...settings })
        }
      }
      state.animSettings = animSettings
      const sliceMasks = new Map()
      for (const [sliceKey, mask] of state.sliceMasks) {
        const { axis, offset } = decodeSliceKey(sliceKey)
        const ai = axisIndex(axis)
        const [loOffset, hiOffset] = rescaleCoord(offset)
        const lo = new Set<string>()
        const hi = new Set<string>()
        for (const cellKey of mask) {
          const [x, y, z] = decodeKey(cellKey)
          for (let i = 0; i < 8; i++) {
            const cx = RESCALE_FACTOR * x + (i & 1)
            const cy = RESCALE_FACTOR * y + ((i >> 1) & 1)
            const cz = RESCALE_FACTOR * z + ((i >> 2) & 1)
            const target = [cx, cy, cz][ai] === loOffset ? lo : hi
            target.add(encodeKey(cx, cy, cz))
          }
        }
        sliceMasks.set(encodeSliceKey(axis, loOffset), lo)
        sliceMasks.set(encodeSliceKey(axis, hiOffset), hi)
      }
      state.sliceMasks = sliceMasks
      const slicePivots = new Map()
      for (const [sliceKey, cellKey] of state.slicePivots) {
        const { axis, offset } = decodeSliceKey(sliceKey)
        const [x, y, z] = decodeKey(cellKey)
        const doubled = encodeKey(RESCALE_FACTOR * x, RESCALE_FACTOR * y, RESCALE_FACTOR * z)
        for (const doubledOffset of rescaleCoord(offset)) {
          slicePivots.set(encodeSliceKey(axis, doubledOffset), doubled)
        }
      }
      state.slicePivots = slicePivots

      // Snapshots can't span an extent change (they hold model/markers/texture/anim, never meta),
      // so all three histories clear — rescale is not undoable, like resize. Selections and
      // floats hold stale plane coordinates and clear after the bake above (clipboards are kept:
      // paste clips to the new bounds). Hover references dead cells, so it resets too.
      state.past = []
      state.future = []
      state.texturePast = []
      state.textureFuture = []
      state.animPast = []
      state.animFuture = []
      state.selection = null
      state.selectedCells = new Set<CellKey>()
      state.floatContent = null
      state.floatOrigin = null
      state.textureSelection = null
      state.textureFloat = null
      state.textureFloatOrigin = null
      state.objectModeTarget = null
      state.paintLineAnchor = null
      state.hoverCell = null
      state.chamferHoverValid = null
      state.hoveredFace = null
      // Same slice on screen is twice as far out after doubling.
      state.plane.offset = clampPlaneOffset(RESCALE_FACTOR * state.plane.offset, extent)
    })
    // A rescale moves the offset — persist the pose it settled on.
    savePlanePref(get().plane)
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
        texelScale: TEXEL_SCALE,
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
      state.noiseScale = 1
      state.aoStrength = 1
      state.exportScaleFactor = 100
      state.exportAnchor = 'center'
      state.exportIncludeTextureMaps = true
      state.exportIncludeAOMaps = true
      state.exportIncludeMarkers = true
      state.animSettings = new Map()
      state.sliceMasks = new Map()
      state.slicePivots = new Map()
      state.animPast = []
      state.animFuture = []
      state.markers = []
      state.selectedMarkerId = null
      state.rigBoxes = []
      state.selectedRigBoxId = null
      state.dirty = true
      // A new project starts grounded (see resetPlaneToGround) instead of inheriting a stale
      // mid-air slice — applied after this block so it reads the fresh extent.
      state.objectModeTarget = null
      // View/tool prefs (active tool, palette slot) carry over deliberately — but a
      // stale voxel selection would clip painting on the fresh canvas via an invisible mask, and
      // hover state references dead cells, so both reset. (Clipboards are kept: pasting across
      // projects is safe — paste clips to the new bounds.)
      state.selection = null
      state.selectedCells = new Set<CellKey>()
      state.floatContent = null
      state.floatOrigin = null
      state.hoverCell = null
      state.chamferHoverValid = null
      state.hoveredFace = null
      state.paintLineAnchor = null
    })
    get().resetPlaneToGround()
  },
})