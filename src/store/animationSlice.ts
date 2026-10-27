import type { StateCreator } from 'zustand'
import type { CellKey, Coord } from '@/engine/grid/types'
import { withinWorkingBounds } from '@/engine/grid/GridStore'
import type { RigBox } from '@/engine/rigging/types'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
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

function cloneSlicePivots(map: Map<SliceKey, CellKey>): Map<SliceKey, CellKey> {
  return new Map(map)
}

function cloneSnapshot(state: { animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>>; slicePivots: Map<SliceKey, CellKey>; rigBoxes: RigBox[] }): AnimSnapshot {
  return {
    animSettings: cloneAnimSettings(state.animSettings),
    sliceMasks: cloneSliceMasks(state.sliceMasks),
    slicePivots: cloneSlicePivots(state.slicePivots),
    rigBoxes: state.rigBoxes.map((b) => ({ ...b, min: [...b.min] as Coord, max: [...b.max] as Coord, pivot: b.pivot ? ([...b.pivot] as Coord) : null })),
  }
}

export const createAnimationSlice: Slice = (set, get) => ({
  animSettings: new Map(),
  sliceMasks: new Map(),
  slicePivots: new Map(),
  animPast: [],
  animFuture: [],

  setPivotForCurrentSlice: (u: number, v: number) => {
    const { plane, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    // Animate mode edits the rig, not slices: the Pivot tool sets the selected box's rotation
    // center (shared selection gating + toast via setSelectedRigPivot; setRigPivot self-brackets
    // the same undo stroke, so no double bracketing here). Slice pivots are legacy playback
    // state — without a selection there is nothing to pin.
    return get().setSelectedRigPivot(coord)
  },

  clearPivotForCurrentSlice: () => {
    // Mirrors setPivotForCurrentSlice: right-click resets the selected box's pivot override.
    // Slice pivots are no longer authorable — no selection means nothing to clear.
    const { selectedRigBoxId, rigBoxes } = get()
    if (!selectedRigBoxId || !rigBoxes.some((b) => b.id === selectedRigBoxId)) return
    get().setRigPivot(selectedRigBoxId, null)
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

  animCancelStroke: () => {
    animStrokeBaseline = null
  },

  animUndo: () => {
    set((state) => {
      const prev = state.animPast.pop()
      if (!prev) return
      state.animFuture.unshift(cloneSnapshot(state))
      state.animSettings = prev.animSettings
      state.sliceMasks = prev.sliceMasks
      state.slicePivots = prev.slicePivots
      state.rigBoxes = prev.rigBoxes
      if (state.selectedRigBoxId && !state.rigBoxes.some((b) => b.id === state.selectedRigBoxId)) {
        state.selectedRigBoxId = null
      }
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
      state.slicePivots = next.slicePivots
      state.rigBoxes = next.rigBoxes
      if (state.selectedRigBoxId && !state.rigBoxes.some((b) => b.id === state.selectedRigBoxId)) {
        state.selectedRigBoxId = null
      }
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
    if (settings.swingAmount !== other.swingAmount) return false
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

function slicePivotsEqual(a: Map<SliceKey, CellKey>, b: Map<SliceKey, CellKey>): boolean {
  if (a.size !== b.size) return false
  for (const [key, cellKey] of a) {
    if (b.get(key) !== cellKey) return false
  }
  return true
}

function rigBoxesEqual(a: RigBox[], b: RigBox[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id || x.name !== y.name) return false
    if ((x.parentId ?? null) !== (y.parentId ?? null)) return false
    if (x.min[0] !== y.min[0] || x.min[1] !== y.min[1] || x.min[2] !== y.min[2]) return false
    if (x.max[0] !== y.max[0] || x.max[1] !== y.max[1] || x.max[2] !== y.max[2]) return false
    const xp = x.pivot ?? null
    const yp = y.pivot ?? null
    if (!xp !== !yp) return false
    if (xp && yp && (xp[0] !== yp[0] || xp[1] !== yp[1] || xp[2] !== yp[2])) return false
  }
  return true
}

function snapshotsEqual(a: AnimSnapshot, b: { animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>>; slicePivots: Map<SliceKey, CellKey>; rigBoxes: RigBox[] }): boolean {
  return mapsEqual(a.animSettings, b.animSettings) && sliceMasksEqual(a.sliceMasks, b.sliceMasks) && slicePivotsEqual(a.slicePivots, b.slicePivots) && rigBoxesEqual(a.rigBoxes, b.rigBoxes)
}
