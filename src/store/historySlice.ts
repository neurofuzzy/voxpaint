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

  undo: () => {
    // A pending float holds an open undo stroke (beginStroke() already captured a baseline) —
    // popping `past` out from under it would leave that baseline dangling. Baking first pushes
    // the pre-lift state onto `past`, so this pop then immediately restores it: one Undo press
    // cleanly reverts the whole lift/move/rotate/mirror gesture, recoverable via Redo.
    get().bakeFloatIfAny()
    set((state) => {
      const prev = state.past.pop()
      if (!prev) return
      state.future.unshift(state.model as VoxelModel)
      state.model = prev
    })
  },

  redo: () => {
    get().bakeFloatIfAny()
    set((state) => {
      const next = state.future.shift()
      if (!next) return
      state.past.push(state.model as VoxelModel)
      state.model = next
    })
  },
})
