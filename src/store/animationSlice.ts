import type { StateCreator } from 'zustand'
import type { CellKey, Coord } from '@/engine/grid/types'
import { encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { AnimationSpeed, AnimationType, SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { defaultAnimationSettings, encodeSliceKey } from '@/engine/animation/animationLayers'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { AnimSnapshot, AppState, AnimationSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], AnimationSlice>

const MAX_HISTORY = 100

let animStrokeBaseline: AnimSnapshot | null = null

function cloneAnimSettings(map: Map<SliceKey, SliceAnimSettings>): Map<SliceKey, SliceAnimSettings> {
  const clone = new Map<SliceKey, SliceAnimSettings>()
  for (const [key, settings] of map) clone.set(key, { ...settings })
  return clone
}

function cloneSliceMasks(map: Map<SliceKey, Set<CellKey>>): Map<SliceKey, Set<CellKey>> {
  const clone = new Map<SliceKey, Set<CellKey>>()
  for (const [key, mask] of map) clone.set(key, new Set(mask))
  return clone
}

function cloneSnapshot(state: { animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>> }): AnimSnapshot {
  return { animSettings: cloneAnimSettings(state.animSettings), sliceMasks: cloneSliceMasks(state.sliceMasks) }
}

export const createAnimationSlice: Slice = (set, get) => ({
  animSettings: new Map(),
  sliceMasks: new Map(),
  animPast: [],
  animFuture: [],

  setAnimSettingsForSlice: (axis, offset, settings) => {
    const sliceKey = encodeSliceKey(axis, offset)
    get().animBeginStroke()
    set((state) => {
      if (settings === null) {
        state.animSettings.delete(sliceKey)
      } else {
        state.animSettings.set(sliceKey, settings)
      }
      state.dirty = true
    })
    get().animCommitStroke()
  },

  clearAllAnimations: () =>
    set((state) => {
      state.animSettings = new Map()
      state.sliceMasks = new Map()
      state.animPast = []
      state.animFuture = []
    }),

  setAnimationTypeForCurrentSlice: (type: AnimationType) => {
    const { axis, offset } = get().plane
    if (type === 'none') {
      get().setAnimSettingsForSlice(axis, offset, null)
      return
    }
    const key = encodeSliceKey(axis, offset)
    const prev = get().animSettings.get(key) ?? defaultAnimationSettings()
    get().setAnimSettingsForSlice(axis, offset, { ...prev, animationType: type })
  },

  setAnimationSpeedForCurrentSlice: (speed: AnimationSpeed) => {
    const { axis, offset } = get().plane
    const key = encodeSliceKey(axis, offset)
    const prev = get().animSettings.get(key) ?? defaultAnimationSettings()
    get().setAnimSettingsForSlice(axis, offset, { ...prev, speed })
  },

  setSlideAmountForCurrentSlice: (amount: number) => {
    const { axis, offset } = get().plane
    const key = encodeSliceKey(axis, offset)
    const prev = get().animSettings.get(key) ?? defaultAnimationSettings()
    get().setAnimSettingsForSlice(axis, offset, { ...prev, slideAmount: amount })
  },

  paintMaskCell: (u: number, v: number) => {
    const { plane, model } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord)) return false
    const key = encodeKey(...coord)
    // Masking only ever makes sense over voxels that exist — painting empty space would be a no-op
    // that silently does nothing once intersected against sliceVoxelKeys anyway.
    if (!model.color.has(key)) return false
    const sliceKey = encodeSliceKey(plane.axis, plane.offset)
    set((state) => {
      let mask = state.sliceMasks.get(sliceKey)
      if (!mask) {
        mask = new Set()
        state.sliceMasks.set(sliceKey, mask)
      }
      mask.add(key)
      state.dirty = true
    })
    return true
  },

  eraseMaskCell: (coord: Coord) => {
    const { plane } = get()
    const sliceKey = encodeSliceKey(plane.axis, plane.offset)
    set((state) => {
      const mask = state.sliceMasks.get(sliceKey)
      if (!mask) return
      const key = encodeKey(...coord)
      mask.delete(key)
      // An emptied mask reverts the slice to "animate the whole slice" — matches an unpainted slice.
      if (mask.size === 0) state.sliceMasks.delete(sliceKey)
      state.dirty = true
    })
  },

  animBeginStroke: () => {
    animStrokeBaseline = cloneSnapshot(get())
  },

  animCommitStroke: () => {
    const baseline = animStrokeBaseline
    animStrokeBaseline = null
    if (!baseline) return
    const current = get()
    if (snapshotsEqual(baseline, current)) return
    set((state) => {
      state.animPast.push(baseline)
      if (state.animPast.length > MAX_HISTORY) state.animPast.shift()
      state.animFuture = []
    })
  },

  animUndo: () => {
    set((state) => {
      const prev = state.animPast.pop()
      if (!prev) return
      state.animFuture.unshift(cloneSnapshot(state))
      state.animSettings = prev.animSettings
      state.sliceMasks = prev.sliceMasks
      state.dirty = true
    })
  },

  animRedo: () => {
    set((state) => {
      const next = state.animFuture.shift()
      if (!next) return
      state.animPast.push(cloneSnapshot(state))
      state.animSettings = next.animSettings
      state.sliceMasks = next.sliceMasks
      state.dirty = true
    })
  },
})

function mapsEqual(a: Map<SliceKey, SliceAnimSettings>, b: Map<SliceKey, SliceAnimSettings>): boolean {
  if (a.size !== b.size) return false
  for (const [key, settings] of a) {
    const other = b.get(key)
    if (!other) return false
    if (settings.animationType !== other.animationType) return false
    if (settings.speed !== other.speed) return false
    if (settings.slideAmount !== other.slideAmount) return false
  }
  return true
}

function sliceMasksEqual(a: Map<SliceKey, Set<CellKey>>, b: Map<SliceKey, Set<CellKey>>): boolean {
  if (a.size !== b.size) return false
  for (const [key, mask] of a) {
    const other = b.get(key)
    if (!other || other.size !== mask.size) return false
    for (const cellKey of mask) if (!other.has(cellKey)) return false
  }
  return true
}

function snapshotsEqual(a: AnimSnapshot, b: { animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>> }): boolean {
  return mapsEqual(a.animSettings, b.animSettings) && sliceMasksEqual(a.sliceMasks, b.sliceMasks)
}
