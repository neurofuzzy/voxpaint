import type { StateCreator } from 'zustand'
import { clampPlaneOffset, effectiveExtent } from '@/engine/grid/GridStore'
import type { CellKey } from '@/engine/grid/types'
import { savePlanePref } from '@/engine/persistence/uiPrefs'
import type { AppState, PlaneSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PlaneSlice>

export const createPlaneSlice: Slice = (set, get) => ({
  plane: { axis: 'z', orientation: 1, offset: 0 },
  objectModeTarget: null,
  planeLocked3D: false,

  setPlaneLocked3D: (v) => {
    set((state) => {
      state.planeLocked3D = v
    })
  },

  // A pending float's cells are offsets interpreted against the plane active at lift/bake time —
  // switching planes out from under it would bake it onto the wrong 3D cells, so bake first.
  // An explicit plane change also dismisses any selection (2D or 3D): the selection was made
  // against the old slice, and mouse-click plane moves are suppressed while one is active (see
  // Viewport3D) — so reaching here means a deliberate wheel/UI/keyboard change.
  setPlaneAxisOrientation: (axis, orientation) => {
    get().bakeFloatIfAny()
    set((state) => {
      state.plane.axis = axis
      state.plane.orientation = orientation
      // Any plane change not driven by handleVoxelFaceClick's own logic invalidates the
      // same-voxel-click-again target (the highlighted face no longer corresponds to it).
      state.objectModeTarget = null
      state.selection = null
      state.selectedCells = new Set<CellKey>()
    })
    // The pose persists across refreshes (project switches reset it instead — see
    // resetPlaneToGround), so the current slice survives a page reload.
    savePlanePref(get().plane)
  },

  setPlaneOffset: (offset) => {
    get().bakeFloatIfAny()
    // The plane lives inside the project bounds — scrolling, stepping, or click-advancing past
    // the top/bottom layer pins to it instead of drifting into empty space.
    const clamped = clampPlaneOffset(offset, get().meta.gridExtent)
    set((state) => {
      state.plane.offset = clamped
      state.objectModeTarget = null
      state.selection = null
      state.selectedCells = new Set<CellKey>()
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
      state.objectModeTarget = null
    })
    savePlanePref(get().plane)
  },

  handleVoxelFaceClick: (cellKey, axis, orientation, offset) => {
    const current = get().objectModeTarget
    // "Again" means the exact same face, not just the same voxel — a click on a different face
    // of the same voxel must switch the plane to that new face, not advance along the old one.
    if (current && current.cellKey === cellKey && current.axis === axis && current.orientation === orientation) {
      // Second click on the same face: advance one step forward through it.
      get().setPlaneOffset(current.offset + current.orientation)
      return
    }
    get().setPlaneAxisOrientation(axis, orientation)
    get().setPlaneOffset(offset)
    set((state) => {
      state.objectModeTarget = { cellKey, axis, orientation, offset }
    })
  },
})
