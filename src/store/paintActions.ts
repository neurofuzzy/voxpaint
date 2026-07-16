import type { StateCreator } from 'zustand'
import { decodeKey, encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord, Rotation } from '@/engine/grid/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { isCellSelected } from '@/engine/tools/selectionMask'
import type { AppState, PaintActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PaintActionsSlice>

let freshChamferKeys: Set<string> | null = null
// Wedge cells painted this stroke that haven't yet matched a real 2-neighbor corner — still at
// their rotation-0 fallback and eligible for retry as more of the stroke gets painted. A key
// leaves this set (frozen) as soon as it finds a true match, even mid-stroke.
let pendingWedgeKeys: Set<string> | null = null

export function beginFreshChamferTracking() {
  freshChamferKeys = new Set()
  pendingWedgeKeys = new Set()
}

export function endFreshChamferTracking() {
  freshChamferKeys = null
  pendingWedgeKeys = null
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
      } else if (activeVoxelKind === 'wedge') {
        const existing = state.model.chamfer.get(key)
        const alreadyFinalized = existing?.resolvedTo?.shapeKind === 'wedge' && !pendingWedgeKeys?.has(key)

        if (alreadyFinalized) {
          // Re-clicking a wedge that's already locked in (this stroke or a prior one) manually
          // rotates it 90° — the escape hatch for configs that never auto-resolve.
          const rotation = ((existing!.resolvedTo!.rotation + 1) % 4) as Rotation
          existing!.resolvedTo = { shapeKind: 'wedge', rotation }
        } else {
          const resolved = classify(sampleNeighbors(state.model, plane, u, v))
          const rotation = resolved?.shapeKind === 'convex' ? resolved.rotation : 0
          state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: 'wedge', rotation } })

          if (pendingWedgeKeys) {
            if (resolved?.shapeKind === 'convex') pendingWedgeKeys.delete(key)
            else pendingWedgeKeys.add(key)

            const pi = axisIndex(plane.axis)
            for (const pendingKey of pendingWedgeKeys) {
              const cell = state.model.chamfer.get(pendingKey)
              if (!cell) {
                pendingWedgeKeys.delete(pendingKey)
                continue
              }
              const pc = decodeKey(pendingKey)
              if (pc[pi] !== plane.offset) continue
              const { u: pu, v: pv } = pixelFromGridCoord(plane, pc)
              const rt = classify(sampleNeighbors(state.model, plane, pu, pv))
              if (rt?.shapeKind === 'convex') {
                cell.resolvedTo = { shapeKind: 'wedge', rotation: rt.rotation }
                pendingWedgeKeys.delete(pendingKey)
              }
            }
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
