import type { StateCreator } from 'zustand'
import type { VoxelModel } from '@/engine/grid/types'
import type { AppState, HistorySlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], HistorySlice>

const MAX_HISTORY = 100

// Transient, not part of observable state — the model reference captured when a gesture began.
// Reading `get().model` outside of a producer returns the real (non-draft) current value, so
// this is safe against Immer's draft-proxy semantics.
let strokeBaseline: VoxelModel | null = null

export const createHistorySlice: Slice = (set, get) => ({
  past: [],
  future: [],

  beginStroke: () => {
    strokeBaseline = get().model
  },

  commitStroke: () => {
    const baseline = strokeBaseline
    strokeBaseline = null
    if (!baseline || baseline === get().model) return // no-op gesture, nothing changed
    set((state) => {
      state.past.push(baseline)
      if (state.past.length > MAX_HISTORY) state.past.shift()
      state.future = []
    })
  },

  undo: () =>
    set((state) => {
      const prev = state.past.pop()
      if (!prev) return
      state.future.unshift(state.model as VoxelModel)
      state.model = prev
    }),

  redo: () =>
    set((state) => {
      const next = state.future.shift()
      if (!next) return
      state.past.push(state.model as VoxelModel)
      state.model = next
    }),
})
