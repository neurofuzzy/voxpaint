import type { StateCreator } from 'zustand'
import { encodeKey } from '@/engine/grid/GridStore'
import { floodFillOccupied3D } from '@/engine/tools/floodFill'
import { WAND_DOUBLE_TAP_MS, regionForFloodedCells, wandSelectionForComponent } from '@/engine/tools/wandTool'
import { showToast } from '@/components/ui/toastBus'
import type { AppState, SelectionSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], SelectionSlice>

// Transient, not part of observable state — when the wand last fired (see `applyWandAt`). Read
// via `get()`-adjacent module scope like historySlice.ts's strokeBaseline, so rapid clicks never
// re-render subscribers.
let lastWandAt: number | null = null

export const createSelectionSlice: Slice = (set, get) => ({
  selection: null,
  clipboard: null,
  floatContent: null,
  floatOrigin: null,
  wandAnchor: null,

  // Establishing a genuinely new selection (or deselecting) is a bake trigger (spec: "not write
  // until deselected or selection change") — bake any pending float before switching. Internal
  // float-lifecycle code (liftSelectionToFloat/moveFloatTo/transformFloat/bakeFloatIfAny) updates
  // `state.selection` directly within its own producers instead of calling this action, so it
  // never re-triggers this guard against itself.
  setSelection: (region) => {
    get().bakeFloatIfAny()
    get().clearStatusAlert()
    // Any new selection invalidates a wand anchor (see `wandAnchor` in types.ts) — the region
    // reverts to plain selection semantics.
    set((state) => { state.selection = region; state.wandAnchor = null })
  },
  setWandSelection: (region, anchor) => {
    get().bakeFloatIfAny()
    get().clearStatusAlert()
    set((state) => { state.selection = region; state.wandAnchor = anchor })
  },
  applyWandAt: (start) => {
    const { model, plane, meta, wandAnchor } = get()
    const startKey = encodeKey(...start)
    if (!model.color.has(startKey)) {
      lastWandAt = null
      get().setSelection(null)
      return
    }
    const now = Date.now()
    // Rapid re-tap expands to the whole component — but only when the new click is occupancy
    // connected to the current anchor (same component, e.g. a double-tap). A fast jump to a
    // disconnected chunk restarts at color-connected instead of exploding, and anything slower
    // restarts too. The flood doubles as the connectivity check and the expansion set.
    const gap = lastWandAt === null ? Infinity : now - lastWandAt
    const prevCell = wandAnchor && model.color.has(encodeKey(...wandAnchor.cell)) ? wandAnchor.cell : null
    if (gap >= 0 && gap <= WAND_DOUBLE_TAP_MS && prevCell) {
      const keys = floodFillOccupied3D(model, start, meta.gridExtent)
      if (keys.includes(encodeKey(...prevCell))) {
        lastWandAt = now
        get().setWandSelection(regionForFloodedCells(plane, keys), { cell: start, match: 'occupied' })
        showToast(`Wand: ${keys.length} voxels (whole component)`)
        return
      }
    }
    const found = wandSelectionForComponent(model, plane, start, meta.gridExtent, 'color')
    // Start is occupied, so the color flood always finds at least it.
    lastWandAt = now
    get().setWandSelection(found!.region, { cell: found!.anchor, match: 'color' })
    // Report the stage: without this the two stages are indistinguishable on screen and a
    // same-color (or interior-connected) component reads as "selecting too much".
    const count = found!.region.mask.reduce((n, b) => n + b, 0)
    showToast(`Wand: ${count} voxel${count === 1 ? '' : 's'} (color-connected) — re-tap quickly for the whole component`)
    // No tool handoff: the wand stays active so a rapid re-tap can expand the selection, and
    // the rail treats wand-with-selection as a select subtool (see FloatingPalette).
  },
  setClipboard: (clipboard) => set((state) => { state.clipboard = clipboard }),
})
