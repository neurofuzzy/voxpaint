import type { StateCreator } from 'zustand'
import { encodeKey } from '@/engine/grid/GridStore'
import type { CellKey, Coord } from '@/engine/grid/types'
import { floodFillOccupied3D, floodFillRegion3D } from '@/engine/tools/floodFill'
import { WAND_DOUBLE_TAP_MS, regionForFloodedCells } from '@/engine/tools/wandTool'
import { showToast } from '@/components/ui/toastBus'
import type { AppState, Selection3DSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], Selection3DSlice>

// Transient, not part of observable state — when and where the wand last fired (see
// `applyWandAt`). Module scope like historySlice.ts's strokeBaseline, so rapid clicks never
// re-render subscribers.
let lastWandAt: number | null = null
let lastWandCell: Coord | null = null

export const createSelection3DSlice: Slice = (set, get) => ({
  selectedCells: new Set<CellKey>(),
  selectedCellsPreview: null,

  // A fresh 3D selection bakes any pending float first, mirroring setSelection's rule — a
  // pending float never survives a selection change. Always replace wholesale (never mutate in
  // place) so subscribers observe the change.
  setSelectedCells: (cells) => {
    get().bakeFloatIfAny()
    get().clearStatusAlert()
    set((state) => { state.selectedCells = new Set(cells) })
  },
  clearSelectedCells: () => {
    set((state) => { state.selectedCells = new Set<CellKey>() })
  },
  setSelectedCellsPreview: (cells) => {
    set((state) => { state.selectedCellsPreview = cells ? new Set(cells) : null })
  },

  applyWandAt: (start) => {
    const { model, plane, meta, layoutMode } = get()
    const startKey = encodeKey(...start)
    if (!model.color.has(startKey)) {
      lastWandAt = null
      lastWandCell = null
      // Bake first: an empty tap clears the selection, which would otherwise strand a pending
      // paste float with no set to follow it (the split branch bakes via setSelection too).
      get().bakeFloatIfAny()
      if (layoutMode === '3d-only') get().clearSelectedCells()
      else get().setSelection(null)
      return
    }
    const now = Date.now()
    // Rapid re-tap expands to the whole component — but only when the new click is occupancy
    // connected to the previous click (same component, e.g. a double-tap). A fast jump to a
    // disconnected chunk restarts at color-connected instead of exploding, and anything slower
    // restarts too. The occupancy flood doubles as the connectivity check and the expansion set.
    const gap = lastWandAt === null ? Infinity : now - lastWandAt
    const prevCell = lastWandCell && model.color.has(encodeKey(...lastWandCell)) ? lastWandCell : null
    let match: 'color' | 'occupied' = 'color'
    let keys: CellKey[] | null = null
    if (gap >= 0 && gap <= WAND_DOUBLE_TAP_MS && prevCell) {
      const occupied = floodFillOccupied3D(model, start, meta.gridExtent)
      if (occupied.includes(encodeKey(...prevCell))) {
        match = 'occupied'
        keys = occupied
      }
    }
    if (!keys) keys = floodFillRegion3D(model, start, meta.gridExtent)
    lastWandAt = now
    lastWandCell = start
    if (layoutMode === '3d-only') {
      get().setSelectedCells(new Set(keys))
    } else {
      get().setSelection(regionForFloodedCells(plane, keys))
    }
    // Report the stage: without this the two stages are indistinguishable on screen and a
    // same-color (or interior-connected) component reads as "selecting too much".
    if (match === 'occupied') showToast(`Wand: ${keys.length} voxels (whole component)`)
    else showToast(`Wand: ${keys.length} voxel${keys.length === 1 ? '' : 's'} (color-connected) — re-tap quickly for the whole component`)
    // No tool handoff: the wand stays active so a rapid re-tap can expand the selection, and
    // the rail treats wand-with-selection as a select subtool (see FloatingPalette).
  },
})
