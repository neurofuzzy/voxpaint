import type { StateCreator } from 'zustand'
import { encodeKey } from '@/engine/grid/GridStore'
import type { CellKey, Coord } from '@/engine/grid/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { coverageKeys, fineDivisionFor, isWholeDivision, regionFromFineCells } from '@/engine/tools/fineSelection'
import { floodFineCells, fineCellColor } from '@/engine/tools/fineWand'
import { floodFillOccupied3D, floodFillRegion, floodFillRegion3D } from '@/engine/tools/floodFill'
import { WAND_DOUBLE_TAP_MS, regionForFloodedCells } from '@/engine/tools/wandTool'
import { showToast } from '@/components/ui/toastBus'
import type { AppState, Fine3DSelection, Selection3DSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], Selection3DSlice>

// Transient, not part of observable state — when and where the wand last fired (see
// `applyWandAt`). Module scope like historySlice.ts's strokeBaseline, so rapid clicks never
// re-render subscribers.
let lastWandAt: number | null = null
let lastWandCell: Coord | null = null
// The sub-voxel wand's own two-stage memory (fine cell + time).
let lastFineWand: { time: number; cell: [number, number] } | null = null

/**
 * The sub-voxel refinement of the 3D selection, or null when there is none or it went stale. It is
 * live only while `selectedCells` still equals the coverage it was made with, so every other write
 * to the set (wand, reorient, project switch, a lift) silently retires it.
 */
export function liveFineSelection3D(s: Pick<AppState, 'selectedFine' | 'selectedCells'>): Fine3DSelection | null {
  const fine = s.selectedFine
  if (!fine) return null
  const keys = coverageKeys(fine.plane, fine.region)
  if (keys.length !== s.selectedCells.size) return null
  return keys.every((k) => s.selectedCells.has(k)) ? fine : null
}

export const createSelection3DSlice: Slice = (set, get) => ({
  selectedCells: new Set<CellKey>(),
  selectedCellsPreview: null,
  selectedFine: null,
  selectedFinePreview: null,
  setSelectedFine: (fine) => {
    get().bakeFloatIfAny()
    get().clearStatusAlert()
    set((state) => {
      state.selectedCells = new Set(coverageKeys(fine.plane, fine.region))
      state.selectedFine = fine
    })
  },
  setSelectedFinePreview: (fine) => set((state) => { state.selectedFinePreview = fine }),

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

  applyWandAt: (start, fineStart) => {
    const { model, plane, meta, layoutMode, gridSplit } = get()
    // Grid not whole: the wand works at the grid's resolution, flooding fine cells on the plane slice.
    const div = fineDivisionFor(plane, gridSplit)
    if (!isWholeDivision(div)) {
      const { u, v } = pixelFromGridCoord(plane, start)
      const f: [number, number] = fineStart ?? [u * div.su, v * div.sv]
      if (fineCellColor(model, plane, div, f[0], f[1], meta.gridExtent) === null) {
        lastFineWand = null
        get().bakeFloatIfAny()
        if (layoutMode === '3d-only') get().clearSelectedCells()
        else get().setSelection(null)
        return
      }
      const now = Date.now()
      let mode: 'color' | 'occupied' = 'color'
      let cells = floodFineCells(model, plane, div, f, 'color', meta.gridExtent)
      if (lastFineWand && now - lastFineWand.time <= WAND_DOUBLE_TAP_MS) {
        const occupied = floodFineCells(model, plane, div, f, 'occupied', meta.gridExtent)
        const [pu, pv] = lastFineWand.cell
        if (occupied.some(([a, b]) => a === pu && b === pv)) {
          mode = 'occupied'
          cells = occupied
        }
      }
      lastFineWand = { time: now, cell: f }
      const region = regionFromFineCells(div, cells)
      if (!region) return
      if (layoutMode === '3d-only') get().setSelectedFine({ region, plane: { ...plane } })
      else get().setSelection(region)
      showToast(
        mode === 'occupied'
          ? `Wand: ${cells.length} sub-voxel cells (whole component)`
          : `Wand: ${cells.length} sub-voxel cell${cells.length === 1 ? '' : 's'} (color-connected) — re-tap quickly for the whole component`,
      )
      return
    }
    const startKey = encodeKey(...start)
    // Subdivided parents flood as one atomic cell: detail has no color entry, so without this
    // the wand would silently select nothing on a detail tap.
    if (model.subdiv.has(startKey)) {
      lastWandAt = null
      lastWandCell = null
      if (layoutMode === '3d-only') get().setSelectedCells(new Set([startKey]))
      else get().setSelection(regionForFloodedCells(plane, [startKey]))
      showToast('Wand: 1 voxel (subdivided detail selects whole)')
      return
    }
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
      // A 3D tap can seed the flood off the active slice (see Viewport3D's wand tap): with no
      // flooded cell on the slice there is no footprint to show, so clear instead of storing
      // a zero-size region.
      get().setSelection(regionForFloodedCells(plane, keys))
    }
    // Report the stage: without this the two stages are indistinguishable on screen and a
    // same-color (or interior-connected) component reads as "selecting too much".
    if (match === 'occupied') showToast(`Wand: ${keys.length} voxels (whole component)`)
    else showToast(`Wand: ${keys.length} voxel${keys.length === 1 ? '' : 's'} (color-connected) — re-tap quickly for the whole component`)
    // No tool handoff: the wand stays active so a rapid re-tap can expand the selection, and
    // the rail treats wand-with-selection as a select subtool (see FloatingPalette).
  },

  /**
   * Plane-constrained wand for the 3D-only window-select tool's double-click: selects the
   * color-connected region on the seed voxel's own slice (same frame as the active plane),
   * never other depths (the full-volume equivalent is the wand tool itself). The committed
   * plane is never moved — shift gestures rely on this, since the seed may sit off it.
   * Single-stage — repeat double-clicks idempotently re-select the same region. Empty seeds
   * leave the selection alone (the tap path only calls this on face hits). No leak guard: the
   * seed is occupied, so an edge-touching same-color region (e.g. a floor plate) is a
   * legitimate grab, not a spill. With `union`, the flood merges into the existing selection
   * (shift-double-click) instead of replacing it.
   */
  applySliceWandAt: (start, union = false) => {
    const { model, plane, meta, layoutMode } = get()
    const startKey = encodeKey(...start)
    if (!model.color.has(startKey)) return
    const slice: ConstructionPlane = { axis: plane.axis, orientation: plane.orientation, offset: start[axisIndex(plane.axis)], half: null }
    const { u, v } = pixelFromGridCoord(slice, start)
    const keys = floodFillRegion(model, slice, u, v, meta.gridExtent)
      .map(([cu, cv]) => encodeKey(...gridCoordFromPixel(slice, cu, cv)))
    if (keys.length === 0) return
    if (layoutMode === '3d-only') {
      get().setSelectedCells(union ? new Set([...get().selectedCells, ...keys]) : new Set(keys))
    } else {
      get().setSelection(regionForFloodedCells(slice, keys))
    }
    showToast(`Selected ${keys.length} voxel${keys.length === 1 ? '' : 's'} on this slice (color-connected)`)
  },
})
