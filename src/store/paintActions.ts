import type { StateCreator } from 'zustand'
import { decodeKey, encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { isCellSelected } from '@/engine/tools/selectionMask'
import type { AppState, PaintActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PaintActionsSlice>

let freshChamferKeys: Set<string> | null = null

export function beginFreshChamferTracking() {
  freshChamferKeys = new Set()
}

export function endFreshChamferTracking() {
  freshChamferKeys = null
}

export const createPaintActionsSlice: Slice = (set, get) => ({
  paintCell: (u: number, v: number) => {
    get().bakeFloatIfAny()
    const { plane, activeVoxelKind, activePaletteSlot, selection, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    // An active selection clips editing to its mask (bakeFloatIfAny above already resolved any float).
    if (selection && !isCellSelected(selection, u, v)) return false

    set((state) => {
      const key = encodeKey(...coord)
      state.model.color.set(key, { paletteSlot: activePaletteSlot })
      state.model.bounds = expandBounds(state.model.bounds, coord)

      if (activeVoxelKind === 'ramp') {
        const resolvedTo = classify(sampleNeighbors(state.model, plane, u, v))
        state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo })

        if (freshChamferKeys) {
          freshChamferKeys.add(key)
          const pi = axisIndex(plane.axis)
          for (const freshKey of freshChamferKeys) {
            const cell = state.model.chamfer.get(freshKey)
            if (!cell || cell.resolvedTo) continue
            const fc = decodeKey(freshKey)
            if (fc[pi] !== plane.offset) continue
            const { u: fu, v: fv } = pixelFromGridCoord(plane, fc)
            const rt = classify(sampleNeighbors(state.model, plane, fu, fv))
            if (rt) cell.resolvedTo = rt
          }
        }
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
    const { plane, selection } = get()
    if (selection) {
      const { u, v } = pixelFromGridCoord(plane, coord)
      if (!isCellSelected(selection, u, v)) return
    }
    set((state) => {
      const key = encodeKey(...coord)
      state.model.color.delete(key)
      state.model.chamfer.delete(key)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
  },
})
