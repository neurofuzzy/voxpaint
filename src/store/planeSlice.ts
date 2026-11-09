import type { StateCreator } from 'zustand'
import { clampPlaneOffset, decodeKey, effectiveExtent } from '@/engine/grid/GridStore'
import type { CellKey } from '@/engine/grid/types'
import { savePlanePref } from '@/engine/persistence/uiPrefs'
import { rigIdForCoord } from '@/engine/rigging/types'
import type { AppState, PlaneSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PlaneSlice>

export const createPlaneSlice: Slice = (set, get) => ({
  plane: { axis: 'z', orientation: 1, offset: 0 },
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
    set((state) => {
      state.plane.axis = axis
      state.plane.orientation = orientation
      // Any plane change not driven by handleVoxelFaceClick's own logic invalidates the
      // same-voxel-click-again target (the highlighted face no longer corresponds to it).
      state.objectModeTarget = null
      if (reoriented) {
        state.selection = null
        state.selectedCells = new Set<CellKey>()
      }
    })
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
      state.objectModeTarget = null
    })
    savePlanePref(get().plane)
  },

  handleVoxelFaceClick: (cellKey, axis, orientation, offset) => {
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
