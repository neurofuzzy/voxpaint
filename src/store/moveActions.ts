import type { StateCreator } from 'zustand'
import type { ChamferCell, ColorCell, Coord } from '@/engine/grid/types'
import { decodeKey, effectiveExtent, encodeKey, recomputeBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { rectRegion } from '@/engine/tools/selectionMask'
import type { AppState, MoveActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], MoveActionsSlice>

// Transient, not observable state — the set of cells being dragged this gesture, plus the plane's
// world u/v basis and where they were last placed. Module-level (like historySlice's strokeBaseline)
// so it isn't drafted by Immer and doesn't churn React.
type MoveGesture = {
  snapshot: Array<{ coord: Coord; color?: ColorCell; chamfer?: ChamferCell }>
  uDir: Coord
  vDir: Coord
  placedKeys: string[]
}
let gesture: MoveGesture | null = null

const cloneChamfer = (c: ChamferCell): ChamferCell => ({
  planeAxis: c.planeAxis,
  planeOrientation: c.planeOrientation,
  resolvedTo: c.resolvedTo ? { ...c.resolvedTo } : null,
})

/**
 * The Move tool's engine: a **direct, live translation** of voxels — no selection, no float. It
 * snapshots the cells to move, then on each drag step deletes the previously-placed copies and
 * re-lays them at the dragged (u,v) offset (mapped to world via the plane's u/v basis), all inside
 * one undo stroke. `wholeModel` (Alt-drag) moves every cell; otherwise only the current plane
 * slice's cells move. Cells dragged out of the working box are simply not re-placed, but stay in the
 * snapshot so they reappear if dragged back within the same gesture.
 */
export const createMoveActionsSlice: Slice = (set, get) => ({
  beginMove: (wholeModel: boolean) => {
    get().bakeFloatIfAny()
    const { model, plane } = get()
    const ai = axisIndex(plane.axis)
    const { uDir, vDir } = planeLogicalBasis(plane.axis)

    const keys = new Set<string>()
    for (const k of model.color.keys()) keys.add(k)
    for (const k of model.chamfer.keys()) keys.add(k)

    const snapshot: MoveGesture['snapshot'] = []
    for (const key of keys) {
      const coord = decodeKey(key)
      if (!wholeModel && coord[ai] !== plane.offset) continue // layer move: current slice only
      snapshot.push({ coord, color: model.color.get(key), chamfer: model.chamfer.get(key) })
    }

    gesture = { snapshot, uDir, vDir, placedKeys: snapshot.map((s) => encodeKey(...s.coord)) }
    get().beginStroke()
  },

  updateMove: (du: number, dv: number) => {
    const g = gesture
    if (!g) return
    set((state) => {
      // Clear last frame's placement, then re-lay every snapshot cell at the new offset.
      for (const k of g.placedKeys) {
        state.model.color.delete(k)
        state.model.chamfer.delete(k)
      }
      const placed: string[] = []
      for (const cell of g.snapshot) {
        const nc: Coord = [
          cell.coord[0] + du * g.uDir[0] + dv * g.vDir[0],
          cell.coord[1] + du * g.uDir[1] + dv * g.vDir[1],
          cell.coord[2] + du * g.uDir[2] + dv * g.vDir[2],
        ]
        if (!withinWorkingBounds(nc, state.meta.gridExtent)) continue
        const nk = encodeKey(...nc)
        if (cell.color) state.model.color.set(nk, { paletteSlot: cell.color.paletteSlot })
        if (cell.chamfer) state.model.chamfer.set(nk, cloneChamfer(cell.chamfer))
        placed.push(nk)
      }
      g.placedKeys = placed
      state.model.bounds = recomputeBounds(state.model)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
  },

  endMove: () => {
    if (!gesture) return
    gesture = null
    get().commitStroke()
  },

  transformWholeModel: (kind) => {
    // Model mode only — the voxel selection/float stack doesn't exist in Texture mode.
    if (get().mode !== 'model') return
    // A select-all + deep-lift + transform + bake, as one gesture: the full-span window covers
    // every cell, the deep lift carries all depths, the float transform renumbers chamfers in
    // the plane frame, and the bake lands back in place (rotation about the grid origin). One
    // undo stroke (lift opens, bake commits); the working selection is cleared afterwards so
    // later paints aren't clipped to it.
    get().bakeFloatIfAny()
    const half = effectiveExtent(get().meta.gridExtent) / 2
    get().setSelection(rectRegion(-half, -half, half - 1, half - 1))
    get().liftSelectionToFloat(true)
    get().transformFloat(kind)
    get().bakeFloatIfAny()
    get().setSelection(null)
  },
})
