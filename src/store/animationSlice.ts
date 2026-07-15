import type { StateCreator } from 'zustand'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { encodeSliceKey } from '@/engine/animation/animationLayers'
import type { AppState, AnimationSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], AnimationSlice>

const MAX_HISTORY = 100

let animStrokeBaseline: Map<SliceKey, SliceAnimSettings> | null = null

function cloneMap(map: Map<SliceKey, SliceAnimSettings>): Map<SliceKey, SliceAnimSettings> {
  const clone = new Map<SliceKey, SliceAnimSettings>()
  for (const [key, settings] of map) {
    clone.set(key, { ...settings })
  }
  return clone
}

export const createAnimationSlice: Slice = (set, get) => ({
  animSettings: new Map(),
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
      state.animPast = []
      state.animFuture = []
    }),

  animBeginStroke: () => {
    animStrokeBaseline = cloneMap(get().animSettings)
  },

  animCommitStroke: () => {
    const baseline = animStrokeBaseline
    animStrokeBaseline = null
    if (!baseline) return
    const current = get().animSettings
    if (mapsEqual(baseline, current)) return
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
      state.animFuture.unshift(cloneMap(state.animSettings))
      state.animSettings = prev
      state.dirty = true
    })
  },

  animRedo: () => {
    set((state) => {
      const next = state.animFuture.shift()
      if (!next) return
      state.animPast.push(cloneMap(state.animSettings))
      state.animSettings = next
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
