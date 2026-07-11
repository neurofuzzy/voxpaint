import type { StateCreator } from 'zustand'
import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import { classify, resolveChamferCellsOnPlane, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { AppState, PaintActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PaintActionsSlice>

export const createPaintActionsSlice: Slice = (set, get) => ({
  paintColorCell: (coord: Coord) => {
    get().bakeFloatIfAny()
    if (!withinWorkingBounds(coord)) return false
    const { plane } = get()
    const slot = get().activePaletteSlot
    set((state) => {
      state.model.color.set(encodeKey(...coord), { paletteSlot: slot })
      state.model.bounds = expandBounds(state.model.bounds, coord)
      // Chamfer adjacency counts any solid neighbor, not just other chamfer cells (see
      // sampleNeighbors) — a plain color paint can be the missing neighbor an unresolved chamfer
      // cell on this same plane slice was waiting on.
      resolveChamferCellsOnPlane(state.model, plane)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    return true
  },

  paintChamferCell: (u: number, v: number) => {
    get().bakeFloatIfAny()
    const { model, plane } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord)) return false

    // Painting a chamfer cell always succeeds, even if its neighbor configuration doesn't
    // resolve to a shape yet (resolvedTo stays null — it renders as a plain cube until enough
    // neighbors join it to resolve; see chamferResolver.ts).
    const resolvedTo = classify(sampleNeighbors(model, plane, u, v))
    const slot = get().activePaletteSlot
    set((state) => {
      const key = encodeKey(...coord)
      state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo })
      // Chamfer paint always also sets color, using the active palette slot (spec §1.1).
      state.model.color.set(key, { paletteSlot: slot })
      state.model.bounds = expandBounds(state.model.bounds, coord)
      // This new cell may be the missing neighbor other still-unresolved cells on this same
      // plane slice were waiting on — re-attempt resolving them too.
      resolveChamferCellsOnPlane(state.model, plane)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    return true
  },

  eraseCell: (coord: Coord, layer) => {
    get().bakeFloatIfAny()
    set((state) => {
      const key = encodeKey(...coord)
      if (layer === 'chamfer') {
        state.model.chamfer.delete(key)
      } else {
        state.model.color.delete(key)
        // A cell with no color cannot render a chamfer shape either (spec §1.1) — clear both.
        state.model.chamfer.delete(key)
      }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
  },
})
