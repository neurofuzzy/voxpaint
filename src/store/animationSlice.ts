import type { StateCreator } from 'zustand'
import type { CellKey, Coord, VoxelModel } from '@/engine/grid/types'
import { withinWorkingBounds } from '@/engine/grid/GridStore'
import type { RigBox, RigClip } from '@/engine/rigging/types'
import type { JointEuler } from '@/engine/rigging/pose'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { AnimSnapshot, AppState, AnimationSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], AnimationSlice>

const MAX_HISTORY = 100

let animStrokeBaseline: AnimSnapshot | null = null
/**
 * Nesting depth for coalesced strokes (slider drags): `animBeginStroke` inside an open
 * stroke only deepens it instead of re-baselining, so a pointer-down → N updates →
 * pointer-up sequence records a single undo entry. Single-shot edits bracket singly and
 * behave exactly as before.
 */
let animStrokeDepth = 0

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

function cloneClips(clips: RigClip[]): RigClip[] {
  return clips.map((c) => ({
    ...c,
    keys: c.keys.map((k) => ({
      ...k,
      joints: Object.fromEntries(Object.entries(k.joints).map(([id, e]) => [id, [...e] as JointEuler])),
      ...(k.offsets ? { offsets: { ...k.offsets } } : {}),
    })),
  }))
}

function cloneSnapshot(state: { animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>>; slicePivots: Map<SliceKey, CellKey>; rigBoxes: RigBox[]; clips: RigClip[]; model: VoxelModel }): AnimSnapshot {
  return {
    animSettings: cloneAnimSettings(state.animSettings),
    sliceMasks: cloneSliceMasks(state.sliceMasks),
    slicePivots: cloneSlicePivots(state.slicePivots),
    rigBoxes: state.rigBoxes.map((b) => ({ ...b, min: [...b.min] as Coord, max: [...b.max] as Coord, pivot: b.pivot ? ([...b.pivot] as Coord) : null, tweens: (b.tweens ?? []).map((t) => ({ ...t })) })),
    clips: cloneClips(state.clips),
    // Reference-shared (never mutated in place — mutations always produce a new model
    // object), so this is free. Present on every clone; the equality check below only
    // treats it as a change when the baseline carried it AND the reference moved, so
    // ordinary rig strokes never record junk entries for untouched voxels.
    model: state.model,
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
    if (animStrokeDepth === 0) animStrokeBaseline = cloneSnapshot(get())
    animStrokeDepth++
  },

  animCommitStroke: () => {
    if (animStrokeDepth === 0) return
    animStrokeDepth--
    if (animStrokeDepth > 0) return
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
    animStrokeDepth = 0
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
      state.clips = prev.clips
      // Part-move entries carry the voxel model so boxes and voxels undo as one gesture.
      if (prev.model) state.model = prev.model
      // Undo can orphan the active clip or the selected key — stop transport and drop
      // dead selections rather than playing a degraded timeline.
      if (state.clipPlaying && !state.clips.some((c) => c.id === state.activeClipId)) {
        state.clipPlaying = false
      }
      if (state.activeClipId && !state.clips.some((c) => c.id === state.activeClipId)) {
        state.activeClipId = state.clips.length > 0 ? state.clips[0].id : null
      }
      if (state.selectedKeyId && !state.clips.some((c) => c.keys.some((k) => k.id === state.selectedKeyId))) {
        state.selectedKeyId = null
      }
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
      state.clips = next.clips
      if (next.model) state.model = next.model
      if (state.clipPlaying && !state.clips.some((c) => c.id === state.activeClipId)) {
        state.clipPlaying = false
      }
      if (state.activeClipId && !state.clips.some((c) => c.id === state.activeClipId)) {
        state.activeClipId = state.clips.length > 0 ? state.clips[0].id : null
      }
      if (state.selectedKeyId && !state.clips.some((c) => c.keys.some((k) => k.id === state.selectedKeyId))) {
        state.selectedKeyId = null
      }
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
    const xt = x.tweens ?? []
    const yt = y.tweens ?? []
    if (xt.length !== yt.length) return false
    for (let k = 0; k < xt.length; k++) {
      const a = xt[k]
      const c = yt[k]
      if (a.id !== c.id || a.kind !== c.kind || a.axis !== c.axis || a.direction !== c.direction || a.speed !== c.speed || a.amount !== c.amount || a.minAngle !== c.minAngle || a.maxAngle !== c.maxAngle || a.enabled !== c.enabled) return false
    }
  }
  return true
}

function jointsEqual(a: Record<string, JointEuler>, b: Record<string, JointEuler>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const key of ak) {
    const xe = a[key]
    const ye = b[key]
    if (!ye || xe[0] !== ye[0] || xe[1] !== ye[1] || xe[2] !== ye[2]) return false
  }
  return true
}

function clipsEqual(a: RigClip[], b: RigClip[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id || x.name !== y.name || x.loop !== y.loop || x.duration !== y.duration) return false
    if (x.keys.length !== y.keys.length) return false
    for (let k = 0; k < x.keys.length; k++) {
      const xk = x.keys[k]
      const yk = y.keys[k]
      if (xk.id !== yk.id || xk.name !== yk.name || xk.time !== yk.time || xk.ease !== yk.ease) return false
      if (!jointsEqual(xk.joints, yk.joints)) return false
      const xo = xk.offsets ?? {}
      const yo = yk.offsets ?? {}
      const xok = Object.keys(xo)
      const yok = Object.keys(yo)
      if (xok.length !== yok.length) return false
      for (const key of xok) {
        const xe = xo[key]
        const ye = yo[key]
        if (!ye || xe[0] !== ye[0] || xe[1] !== ye[1] || xe[2] !== ye[2]) return false
      }
    }
  }
  return true
}

function snapshotsEqual(a: AnimSnapshot, b: { animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>>; slicePivots: Map<SliceKey, CellKey>; rigBoxes: RigBox[]; clips: RigClip[]; model: VoxelModel }): boolean {
  // The model rides every clone by reference, but only counts as a change when the stroke
  // actually replaced it — ordinary rig strokes leave the reference alone and stay quiet.
  if (a.model !== undefined && a.model !== b.model) return false
  return mapsEqual(a.animSettings, b.animSettings) && sliceMasksEqual(a.sliceMasks, b.sliceMasks) && slicePivotsEqual(a.slicePivots, b.slicePivots) && rigBoxesEqual(a.rigBoxes, b.rigBoxes) && clipsEqual(a.clips, b.clips)
}
