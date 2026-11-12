import type { StateCreator } from 'zustand'
import { clampPlaneOffset, decodeKey, effectiveExtent } from '@/engine/grid/GridStore'
import type { Axis, CellKey, Orientation, SplitAxis } from '@/engine/grid/types'
import { savePlanePref } from '@/engine/persistence/uiPrefs'
import { rigIdForCoord } from '@/engine/rigging/types'
import type { AppState, PlaneSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PlaneSlice>

/**
 * A sub-voxel 2D selection addresses the plane's slab: like a whole-layer move re-addresses the
 * same UV window on the new slice, stepping the plane to the other half moves the selection's
 * slab with it. Called inside every producer that changes the plane's half.
 */
function selectionFollowsSlab(state: AppState): void {
  const f = state.selection?.fine
  if (f && f.slab !== null && state.plane.half !== null) f.slab = state.plane.half
}

/** True when the armed grid division cuts along `axis` — the only case where the plane has
 * half-voxel stops. Every plane step follows the grid: no cut on the plane's axis, whole voxels. */
export function gridSplitsAxis(split: SplitAxis[] | null, axis: Axis): boolean {
  return split !== null && split.includes(axis)
}

/**
 * One stop along the plane axis, per the grid — the ONLY rule: grid cuts the plane's axis →
 * half-voxel stops always (low slab → high slab → next voxel's low slab; there is no
 * whole-voxel stop in between); otherwise whole voxels. Monotonic along the world axis in both
 * directions. Pure so the edge dragger can walk it from an anchor without dispatching per stop.
 * `orientation` only picks which slab a whole-voxel plane enters on (the viewer-side one).
 */
export function stepHalfStop(
  offset: number,
  half: 0 | 1 | null,
  direction: 1 | -1,
  orientation: Orientation,
  splitsAxis = true,
): { offset: number; half: 0 | 1 | null } {
  if (!splitsAxis) return { offset: offset + direction, half: null }
  const at = half ?? (orientation === 1 ? 1 : 0)
  if (direction === 1) return at === 0 ? { offset, half: 1 } : { offset: offset + 1, half: 0 }
  return at === 1 ? { offset, half: 0 } : { offset: offset - 1, half: 1 }
}

export const createPlaneSlice: Slice = (set, get) => ({
  plane: { axis: 'z', orientation: 1, offset: 0, half: null },
  objectModeTarget: null,

  // A pending float's cells are offsets interpreted against the plane active at lift/bake time —
  // switching planes out from under it would bake it onto the wrong 3D cells, so bake first.
  // Selection policy: sliding the plane along its own normal (offset shifts, same axis and
  // orientation) keeps both selections — the frame is unchanged, so the 2D window still
  // addresses the same UV rect (now on the new slice) and the 3D set is grid-space anyway.
  // Only a genuine reorient (different axis or facing) dismisses them, since the old frame
  // no longer applies. Clicks on already-selected voxels keep everything instead of moving
  // the plane (see Viewport3D).
  setPlaneAxisOrientation: (axis, orientation) => {
    get().bakeFloatIfAny()
    const reoriented = get().plane.axis !== axis || get().plane.orientation !== orientation
    const axisChanged = get().plane.axis !== axis
    set((state) => {
      state.plane.axis = axis
      state.plane.orientation = orientation
      // Any plane change not driven by handleVoxelFaceClick's own logic invalidates the
      // same-voxel-click-again target (the highlighted face no longer corresponds to it).
      state.objectModeTarget = null
      // A new axis re-frames depth: the half-voxel stop belongs to the old frame (snapped below).
      if (axisChanged) state.plane.half = null
      if (reoriented) {
        state.selection = null
        state.selectedCells = new Set<CellKey>()
      }
    })
    get().snapPlaneToGrid() // the new axis may be one the grid cuts (or no longer cuts)
    // The pose persists across refreshes (project switches reset it instead — see
    // resetPlaneToGround), so the current slice survives a page reload.
    savePlanePref(get().plane)
  },

  setPlaneOffset: (offset) => {
    get().bakeFloatIfAny()
    // The plane lives inside the project bounds — scrolling, stepping, or click-advancing past
    // the top/bottom layer pins to it instead of drifting into empty space. Offset shifts never
    // clear the selection (see above) — only the click-again target resets.
    const clamped = clampPlaneOffset(offset, get().meta.gridExtent)
    set((state) => {
      state.plane.offset = clamped
      state.objectModeTarget = null
    })
    savePlanePref(get().plane)
  },

  resetPlaneToGround: () => {
    get().bakeFloatIfAny()
    const extent = get().meta.gridExtent
    set((state) => {
      // A fresh project starts on the ground: Y-up plane at the lowest layer, so the first
      // paint lands on the floor instead of inheriting a stale mid-air slice.
      state.plane.axis = 'y'
      state.plane.orientation = 1
      state.plane.offset = -effectiveExtent(extent) / 2
      state.plane.half = null
      state.objectModeTarget = null
    })
    get().snapPlaneToGrid()
    savePlanePref(get().plane)
  },

  setPlaneHalf: (half) => {
    // Slab-only switch: the frame (axis/orientation/offset) doesn't move, so no selection
    // invalidation — the selection's slab follows. A pending float bakes first, like any depth
    // move of the plane (its footprint is drawn on the plane's slab).
    if (half !== get().plane.half) get().bakeFloatIfAny()
    set((state) => {
      state.plane.half = half
      selectionFollowsSlab(state)
    })
    savePlanePref(get().plane)
  },

  stepPlaneHalf: (direction, count = 1) => {
    get().bakeFloatIfAny()
    const st = get()
    let offset = st.plane.offset
    let half = st.plane.half
    const n = Math.max(0, Math.floor(count))
    const splits = gridSplitsAxis(st.gridSplit, st.plane.axis)
    for (let i = 0; i < n; i++) {
      const next = stepHalfStop(offset, half, direction, st.plane.orientation, splits)
      // Pin at the bounds: a step that would leave the project stays where it is.
      if (clampPlaneOffset(next.offset, st.meta.gridExtent) !== next.offset) break
      ;({ offset, half } = next)
    }
    set((state) => {
      state.plane.offset = offset
      state.plane.half = half
      state.objectModeTarget = null
      selectionFollowsSlab(state)
    })
    savePlanePref(get().plane)
  },

  // The grid decides which stops exist. When a grid change leaves the plane on a slab the grid no
  // longer cuts, move it to the nearest whole voxel (the slab's own voxel), inside the bounds.
  snapPlaneToGrid: () => {
    const st = get()
    const splits = gridSplitsAxis(st.gridSplit, st.plane.axis)
    // Cut axis: always on a half-voxel stop (enter on the viewer-side slab). Uncut: whole voxel.
    const half = splits ? (st.plane.half ?? (st.plane.orientation === 1 ? 1 : 0)) : null
    const offset = clampPlaneOffset(st.plane.offset, st.meta.gridExtent)
    if (half === st.plane.half && offset === st.plane.offset) return
    set((state) => {
      state.plane.offset = offset
      state.plane.half = half
      selectionFollowsSlab(state)
    })
    savePlanePref(get().plane)
  },

  handleVoxelFaceClick: (cellKey, axis, orientation, offset, half = null) => {
    const current = get().objectModeTarget
    // "Again" means the exact same face, not just the same voxel — a click on a different face
    // of the same voxel must switch the plane to that new face, not advance along the old one.
    if (current && current.cellKey === cellKey && current.axis === axis && current.orientation === orientation) {
      // Animate mode: the second tap selects the rig box the voxel belongs to instead of
      // stepping the plane — tapping through a posed model to chase a slice is never what you
      // want there; wheel/keys/slider still move the plane. Voxels outside every box keep the
      // modeling advance so empty space stays navigable.
      if (get().mode === 'animate') {
        const id = rigIdForCoord(get().rigBoxes, decodeKey(cellKey))
        if (id) {
          get().selectRigBox(id)
          set((state) => { state.objectModeTarget = null })
          return
        }
      }
      // Second click on the same face: advance one layer forward through it (landing on the
      // viewer-side slab when the grid cuts this axis).
      get().setPlaneOffset(current.offset + current.orientation)
      get().setPlaneHalf(null)
      get().snapPlaneToGrid()
      return
    }
    get().setPlaneAxisOrientation(axis, orientation)
    get().setPlaneOffset(offset)
    get().setPlaneHalf(half)
    get().snapPlaneToGrid()
    set((state) => {
      state.objectModeTarget = { cellKey, axis, orientation, offset }
    })
  },
})
