import type { StateCreator } from 'zustand'
import { decodeKey, encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Axis, Coord, Orientation, Rotation } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { findDualRampRotation, findWedgeRampDual } from '@/engine/chamfer/rampDual'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { isCellSelected } from '@/engine/tools/selectionMask'
import type { AppState, PaintActionsSlice, VoxelKind } from './types'

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

/**
 * The paint-cell write itself, parameterized by an explicit plane instead of the store's active
 * one. `paintCell` (2D) passes `get().plane` plus its selection clip; `paintCellAtCoord` (3D
 * direct blocking) passes the synthetic face plane. One implementation, so chamfer
 * classification, wedge retry, and tracking behave identically from either view.
 */
function applyPaintCell(
  state: AppState,
  coord: Coord,
  u: number,
  v: number,
  plane: ConstructionPlane,
  kind: VoxelKind,
  slot: PaletteSlotRef,
) {
  const key = encodeKey(...coord)
  state.model.color.set(key, { paletteSlot: slot })
  state.model.bounds = expandBounds(state.model.bounds, coord)

  if (kind === 'ramp') {
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
  } else if (kind === 'wedge') {
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
  } else if (kind === 'thin') {
    // A thin slab is a normal color cell plus a fixed chamfer entry recording only the
    // outward/thin axis. No neighbor sampling and no rotation — it's symmetric and never
    // auto-resolves (frozen at paint time, like every other shape once resolved).
    state.model.chamfer.set(key, {
      planeAxis: plane.axis,
      planeOrientation: plane.orientation,
      resolvedTo: { shapeKind: 'thin', rotation: 0 },
    })
  } else {
    state.model.chamfer.delete(key)
  }

  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
}

/** Shared erase write (both layers, no selection concept) — `eraseCell` clips first, 3D skips it. */
function applyEraseCell(state: AppState, coord: Coord) {
  const key = encodeKey(...coord)
  state.model.color.delete(key)
  state.model.chamfer.delete(key)
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
}

/**
 * Recolor write: swaps the palette slot on an existing voxel, nothing else. Returns false (and
 * writes nothing, so the enclosing stroke stays a no-op) on empty cells and same-slot repaints.
 */
function applyMaterialCell(state: AppState, coord: Coord, slot: PaletteSlotRef): boolean {
  const key = encodeKey(...coord)
  const existing = state.model.color.get(key)
  if (!existing) return false
  if (existing.paletteSlot.kind === slot.kind && existing.paletteSlot.index === slot.index) return false
  state.model.color.set(key, { paletteSlot: slot })
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
  return true
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
      applyPaintCell(state, coord, u, v, plane, activeVoxelKind, activePaletteSlot)
    })
    return true
  },

  paintCellAtCoord: (coord: Coord, faceAxis: Axis, faceOrientation: Orientation) => {
    get().bakeFloatIfAny()
    const { activeVoxelKind, activePaletteSlot, meta } = get()
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    // The clicked face supplies the chamfer context: its own axis/orientation on the target
    // cell's slice, so 3D-painted shapes bake exactly as if painted from that face in 2D.
    // (Deliberately no selection clip — the 2D selection mask lives in the active plane's frame
    // and can't meaningfully clip a different face's slice.)
    const facePlane: ConstructionPlane = { axis: faceAxis, orientation: faceOrientation, offset: coord[axisIndex(faceAxis)] }
    const { u, v } = pixelFromGridCoord(facePlane, coord)
    set((state) => {
      applyPaintCell(state, coord, u, v, facePlane, activeVoxelKind, activePaletteSlot)
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
      applyEraseCell(state, coord)
    })
  },

  eraseCellAtCoord: (coord: Coord) => {
    get().bakeFloatIfAny()
    set((state) => {
      applyEraseCell(state, coord)
    })
  },

  paintMaterialCell: (u: number, v: number) => {
    get().bakeFloatIfAny()
    const { plane, activePaletteSlot, selection, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    if (selection && !isCellSelected(selection, u, v)) return false
    let changed = false
    set((state) => {
      changed = applyMaterialCell(state, coord, activePaletteSlot)
    })
    return changed
  },

  paintMaterialAtCoord: (coord: Coord) => {
    get().bakeFloatIfAny()
    const { activePaletteSlot, meta } = get()
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    let changed = false
    set((state) => {
      changed = applyMaterialCell(state, coord, activePaletteSlot)
    })
    return changed
  },

  rebaseRampCell: (u: number, v: number) => {
    get().bakeFloatIfAny()
    const { plane, selection, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    if (selection && !isCellSelected(selection, u, v)) return false
    let changed = false
    set((state) => {
      const key = encodeKey(...coord)
      const cell = state.model.chamfer.get(key)
      const kind = cell?.resolvedTo?.shapeKind
      // Ramps and wedges are congruent prisms — both rebase onto a ramp basis reproducing the
      // exact solid (a wedge source converts shapeKind, since its dual is always a ramp).
      if (kind !== 'ramp' && kind !== 'wedge') return
      const rotation = kind === 'ramp'
        ? findDualRampRotation(cell!, plane.axis, plane.orientation)
        : findWedgeRampDual(cell!, plane.axis, plane.orientation)
      if (rotation === null) return
      if (kind === 'ramp' && rotation === cell!.resolvedTo!.rotation && cell!.planeAxis === plane.axis && cell!.planeOrientation === plane.orientation) return
      cell!.planeAxis = plane.axis
      cell!.planeOrientation = plane.orientation
      cell!.resolvedTo = { shapeKind: 'ramp', rotation }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
      changed = true
    })
    return changed
  },
})
