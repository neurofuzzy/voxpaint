import type { StateCreator } from 'zustand'
import type { Marker } from '@/engine/markers/types'
import type { AppState, HistorySlice, ModelSnapshot } from './types'
import { beginFreshChamferTracking, endFreshChamferTracking } from './paintActions'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], HistorySlice>

const MAX_HISTORY = 100

// Transient, not part of observable state — the model + markers captured when a gesture began.
// Reading `get().model` / `get().markers` outside of a producer returns the real (non-draft)
// current values, so this is safe against Immer's draft-proxy semantics.
let strokeBaseline: ModelSnapshot | null = null

export const createHistorySlice: Slice = (set, get) => ({
  past: [],
  future: [],

  beginStroke: () => {
    strokeBaseline = { model: get().model, markers: get().markers }
    beginFreshChamferTracking()
  },

  commitStroke: () => {
    const baseline = strokeBaseline
    strokeBaseline = null
    endFreshChamferTracking()
    // A marker-only gesture leaves the model untouched (and vice versa) — record the stroke
    // when *either* side changed, so marker edits undo together with surrounding voxel work.
    if (!baseline || (baseline.model === get().model && baseline.markers === get().markers)) return
    set((state) => {
      state.past.push(baseline)
      if (state.past.length > MAX_HISTORY) state.past.shift()
      state.future = []
    })
  },

  cancelStroke: () => {
    strokeBaseline = null
    endFreshChamferTracking()
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
      state.future.unshift({ model: state.model, markers: state.markers as Marker[] })
      state.model = prev.model
      state.markers = prev.markers
      if (state.selectedMarkerId && !prev.markers.some((m) => m.id === state.selectedMarkerId)) {
        state.selectedMarkerId = null
      }
    })
  },

  redo: () => {
    get().bakeFloatIfAny()
    set((state) => {
      const next = state.future.shift()
      if (!next) return
      state.past.push({ model: state.model, markers: state.markers as Marker[] })
      state.model = next.model
      state.markers = next.markers
      if (state.selectedMarkerId && !next.markers.some((m) => m.id === state.selectedMarkerId)) {
        state.selectedMarkerId = null
      }
    })
  },
})
