import type { StateCreator } from 'zustand'
import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { AppState, PaintActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PaintActionsSlice>

export const createPaintActionsSlice: Slice = (set, get) => ({
  paintColorCell: (coord: Coord) => {
    get().bakeFloatIfAny()
    if (!withinWorkingBounds(coord)) return false
    const slot = get().activePaletteSlot
    set((state) => {
      state.model.color.set(encodeKey(...coord), { paletteSlot: slot })
      state.model.bounds = expandBounds(state.model.bounds, coord)
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

    const classification = classify(sampleNeighbors(model, plane, u, v))
    if (!classification) return false

    const slot = get().activePaletteSlot
    set((state) => {
      const key = encodeKey(...coord)
      state.model.chamfer.set(key, {
        shapeKind: classification.shapeKind,
        rotation: classification.rotation,
        planeAxis: plane.axis,
        planeOrientation: plane.orientation,
      })
      // Chamfer paint always also sets color, using the active palette slot (spec §1.1).
      state.model.color.set(key, { paletteSlot: slot })
      state.model.bounds = expandBounds(state.model.bounds, coord)
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
