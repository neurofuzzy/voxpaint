import type { StateCreator } from 'zustand'
import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { AppState, PaintActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PaintActionsSlice>

export const createPaintActionsSlice: Slice = (set, get) => ({
  paintCell: (u: number, v: number) => {
    get().bakeFloatIfAny()
    const { model, plane, activeVoxelKind, activePaletteSlot } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord)) return false

    set((state) => {
      const key = encodeKey(...coord)
      state.model.color.set(key, { paletteSlot: activePaletteSlot })
      state.model.bounds = expandBounds(state.model.bounds, coord)

      if (activeVoxelKind === 'ramp') {
        // Resolve only THIS voxel, from its neighbours at paint time. A chamfer never re-resolves
        // due to edits elsewhere — painting a neighbour won't retro-resolve an unresolved cell.
        const resolvedTo = classify(sampleNeighbors(model, plane, u, v))
        state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo })
      } else {
        state.model.chamfer.delete(key)
      }

      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    return true
  },

  eraseCell: (coord: Coord) => {
    get().bakeFloatIfAny()
    set((state) => {
      const key = encodeKey(...coord)
      state.model.color.delete(key)
      state.model.chamfer.delete(key)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
  },
})
