import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { useAppStore } from '@/store/useAppStore'

const SLOT_A = { kind: 'base', index: 0 } as PaletteSlotRef
const SLOT_B = { kind: 'base', index: 3 } as PaletteSlotRef

function paintAt(coord: Coord, slot: PaletteSlotRef = SLOT_A) {
  const s = useAppStore.getState()
  s.setActiveVoxelKind('cube')
  s.setActivePaletteSlot(slot)
  s.beginStroke()
  expect(s.paintCellAtCoord(coord, 'z', 1)).toBe(true)
  s.commitStroke()
}

describe('3D selection store + exact-set actions', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setLayoutMode('3d-only')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('setSelectedCells replaces wholesale; clear empties', () => {
    paintAt([0, 0, 0])
    const key = encodeKey(0, 0, 0)
    useAppStore.getState().setSelectedCells(new Set([key]))
    expect(useAppStore.getState().selectedCells).toEqual(new Set([key]))
    // 2D selection untouched by 3D writes.
    expect(useAppStore.getState().selection).toBeNull()
    useAppStore.getState().clearSelectedCells()
    expect(useAppStore.getState().selectedCells.size).toBe(0)
  })

  it('setSelectedCells bakes a pending float first', () => {
    paintAt([0, 0, 0])
    // (u,v) = (0,-1) on the z=0 plane.
    useAppStore.getState().setSelection({ originU: 0, originV: -1, width: 1, height: 1, mask: new Uint8Array([1]) })
    useAppStore.getState().liftSelectionToFloat()
    expect(useAppStore.getState().floatContent).not.toBeNull()
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0)]))
    // Baked back into the model, float closed.
    expect(useAppStore.getState().floatContent).toBeNull()
    expect(useAppStore.getState().model.color.has(encodeKey(0, 0, 0))).toBe(true)
  })

  it('liftCellsToFloat snapshots exact cells and clears them, leaving 2D state alone', () => {
    paintAt([0, 0, 0])
    paintAt([0, 0, 1])
    paintAt([5, 5, 5])
    const set = new Set([encodeKey(0, 0, 0), encodeKey(0, 0, 1), encodeKey(7, 7, 7)])
    useAppStore.getState().liftCellsToFloat(set)
    const after = useAppStore.getState()
    expect(after.floatContent!.cells).toHaveLength(2) // stale key skipped
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(0, 0, 1))).toBe(false)
    expect(after.model.color.has(encodeKey(5, 5, 5))).toBe(true)
    expect(after.selection).toBeNull() // 2D selection untouched
    expect(after.floatOrigin).toEqual({ originU: 0, originV: -1 })
  })

  it('liftCellsToFloat no-ops on an empty set or a pending float', () => {
    paintAt([0, 0, 0])
    const before = useAppStore.getState().model
    useAppStore.getState().liftCellsToFloat(new Set())
    expect(useAppStore.getState().floatContent).toBeNull()
    expect(useAppStore.getState().model).toBe(before) // no stroke opened
  })

  it('moveFloatCellsTo repositions without touching the 2D selection', () => {
    paintAt([0, 0, 0])
    useAppStore.getState().setSelection({ originU: 4, originV: 4, width: 1, height: 1, mask: new Uint8Array([1]) })
    useAppStore.getState().liftCellsToFloat(new Set([encodeKey(0, 0, 0)]))
    useAppStore.getState().moveFloatCellsTo(2, 2)
    const after = useAppStore.getState()
    expect(after.floatOrigin).toEqual({ originU: 2, originV: 2 })
    // 2D selection left exactly alone (moveFloatTo would have rewritten its origin).
    expect(after.selection).toEqual({ originU: 4, originV: 4, width: 1, height: 1, mask: new Uint8Array([1]) })
    // Pure: model untouched until bake.
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
  })

  it('drop-bake lands the set shifted, one undo step', () => {
    paintAt([0, 0, 0], SLOT_A)
    paintAt([1, 0, 0], SLOT_B)
    useAppStore.getState().liftCellsToFloat(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    useAppStore.getState().moveFloatCellsTo(2, 0)
    useAppStore.getState().bakeFloatIfAny()
    const after = useAppStore.getState()
    expect(after.floatContent).toBeNull()
    expect(after.model.color.get(encodeKey(2, -1, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(encodeKey(3, -1, 0))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.size).toBe(2)
  })

  it('moving an off-plane volume preserves absolute depths (no collapse to the plane)', () => {
    // Wand-selected volume floating at z=2..3 while the plane sits at z=0: dw runs off the
    // set bbox-min, so dw==0 does NOT mean "on the plane" — the move must not re-anchor it.
    paintAt([0, 0, 2], SLOT_A)
    paintAt([1, 0, 3], SLOT_B)
    useAppStore.getState().liftCellsToFloat(new Set([encodeKey(0, 0, 2), encodeKey(1, 0, 3)]))
    // (u,v) of (0,0,2) on the z-plane is (0,-1); shift +2u like a drag would.
    useAppStore.getState().moveFloatCellsTo(2, -1)
    useAppStore.getState().bakeFloatIfAny()
    const after = useAppStore.getState()
    expect(after.floatContent).toBeNull()
    expect(after.model.color.get(encodeKey(2, 0, 2))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(encodeKey(3, 0, 3))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.size).toBe(2)
  })

  it('deleteCells3D erases the exact set at every depth, keeping loners', () => {
    paintAt([0, 0, 0])
    paintAt([0, 0, 1])
    paintAt([1, 0, 0], SLOT_B)
    paintAt([5, 5, 5])
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(0, 0, 1), encodeKey(1, 0, 0)]))
    useAppStore.getState().deleteCells3D()
    const after = useAppStore.getState()
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(0, 0, 1))).toBe(false)
    expect(after.model.color.has(encodeKey(1, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(5, 5, 5))).toBe(true)
    // Set kept (harmless absentees), matching deleteSelection keeping its region.
    expect(after.selectedCells.size).toBe(3)
  })

  it('deleteCells3D no-ops on an empty set without opening a stroke', () => {
    paintAt([0, 0, 0])
    const before = useAppStore.getState().model
    useAppStore.getState().deleteCells3D()
    expect(useAppStore.getState().model).toBe(before)
  })

  it('rotateCells3D turns the set in the active plane and follows it', () => {
    paintAt([0, 0, 0], SLOT_A)
    paintAt([1, 0, 0], SLOT_B)
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    useAppStore.getState().rotateCells3D('rotate')
    const after = useAppStore.getState()
    // Same origin-corner math as float rotate: (0,0,0) fixed, (1,0,0) swings to (0,-1,0).
    expect(after.model.color.get(encodeKey(0, 0, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(encodeKey(0, -1, 0))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.size).toBe(2)
    expect(after.selectedCells).toEqual(new Set([encodeKey(0, 0, 0), encodeKey(0, -1, 0)]))
  })

  it('rotateCells3D renumbers chamfers with the turn', () => {
    useAppStore.setState((s) => {
      s.model.color.set(encodeKey(4, 4, 0), { paletteSlot: { ...SLOT_A } })
      s.model.chamfer.set(encodeKey(4, 4, 0), {
        planeAxis: 'z',
        planeOrientation: 1,
        resolvedTo: { shapeKind: 'ramp', rotation: 0 },
      })
    })
    useAppStore.getState().setSelectedCells(new Set([encodeKey(4, 4, 0)]))
    useAppStore.getState().rotateCells3D('rotate')
    const after = useAppStore.getState()
    // Lone cell stays put; the ramp renumbers 0 → 1 like a float rotate would.
    expect(after.model.color.has(encodeKey(4, 4, 0))).toBe(true)
    expect(after.model.chamfer.get(encodeKey(4, 4, 0))?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 1 })
    expect(after.selectedCells).toEqual(new Set([encodeKey(4, 4, 0)]))
  })

  it('copyCells3D snapshots to the shared clipboard; cut also erases', () => {
    paintAt([0, 0, 0], SLOT_A)
    paintAt([0, 0, 1], SLOT_B)
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(0, 0, 1)]))
    useAppStore.getState().copyCells3D()
    expect(useAppStore.getState().clipboard!.cells).toHaveLength(2)
    useAppStore.getState().cutCells3D()
    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(0)
    expect(after.clipboard!.cells).toHaveLength(2)
  })

  it('pasteCells3D floats the clipboard without touching the model', () => {
    paintAt([0, 0, 0], SLOT_A)
    paintAt([1, 0, 0], SLOT_B)
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    useAppStore.getState().copyCells3D()
    const strokesBefore = useAppStore.getState().past.length
    useAppStore.getState().pasteCells3D()
    const after = useAppStore.getState()
    // Nothing written yet (the source is intact — dragging the ghost duplicates, not moves),
    // but the float is pending and the selection tracks its footprint.
    expect(after.floatContent!.cells).toHaveLength(2)
    expect(after.model.color.get(encodeKey(0, 0, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(encodeKey(1, 0, 0))?.paletteSlot).toEqual(SLOT_B)
    expect(after.selectedCells).toEqual(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    expect(after.past.length).toBe(strokesBefore) // stroke opened, not committed
  })

  it('paste-move-bake duplicates instead of stomping the source', () => {
    paintAt([0, 0, 0], SLOT_A)
    paintAt([1, 0, 0], SLOT_B)
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    useAppStore.getState().copyCells3D()
    const strokesBefore = useAppStore.getState().past.length
    useAppStore.getState().pasteCells3D()
    // (u,v) of (0,0,0) on the z=0 plane is (0,-1): shift +2u like a viewport drag would.
    useAppStore.getState().moveFloatCellsTo(2, -1)
    useAppStore.getState().bakeFloatIfAny()
    const after = useAppStore.getState()
    expect(after.floatContent).toBeNull()
    expect(after.model.color.get(encodeKey(0, 0, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(encodeKey(1, 0, 0))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.get(encodeKey(2, 0, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(encodeKey(3, 0, 0))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.size).toBe(4)
    expect(after.past.length).toBe(strokesBefore + 1) // one undo step for paste+move+bake
  })

  it('cut-paste restores in place — the emptied selection is a matching destination', () => {
    paintAt([0, 0, 0], SLOT_A)
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0)]))
    useAppStore.getState().cutCells3D()
    expect(useAppStore.getState().model.color.size).toBe(0)
    useAppStore.getState().pasteCells3D()
    const after = useAppStore.getState()
    // The cut emptied the selection but kept it, and its 1-wide frame matches: direct stamp.
    expect(after.floatContent).toBeNull()
    expect(after.model.color.get(encodeKey(0, 0, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.selectedCells).toEqual(new Set([encodeKey(0, 0, 0)]))
    // …and the restored selection drags like any other: lift, move, bake.
    useAppStore.getState().liftCellsToFloat(after.selectedCells)
    useAppStore.getState().moveFloatCellsTo(2, -1)
    useAppStore.getState().bakeFloatIfAny()
    const moved = useAppStore.getState()
    expect(moved.model.color.get(encodeKey(2, 0, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(moved.model.color.size).toBe(1)
  })

  it('paste re-anchors to the lift slice when the plane moved', () => {
    paintAt([0, 0, 2], SLOT_A)
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 2)]))
    useAppStore.getState().copyCells3D()
    // Move the plane away — a same-plane float still ghosts the recorded lift slice.
    useAppStore.getState().setPlaneOffset(5)
    useAppStore.getState().pasteCells3D()
    const after = useAppStore.getState()
    expect(after.floatContent).not.toBeNull()
    expect(after.selectedCells).toEqual(new Set([encodeKey(0, 0, 2)]))
    after.bakeFloatIfAny()
    expect(useAppStore.getState().model.color.get(encodeKey(0, 0, 2))?.paletteSlot).toEqual(SLOT_A)
  })

  it('paste into an empty matching selection stamps directly with no float', () => {
    paintAt([0, 0, 0], SLOT_A)
    paintAt([1, 0, 0], SLOT_B)
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    useAppStore.getState().copyCells3D()
    // A fresh empty 2-wide frame elsewhere takes the paste directly.
    const frame = new Set([encodeKey(5, 0, 0), encodeKey(6, 0, 0)])
    useAppStore.getState().setSelectedCells(frame)
    const strokesBefore = useAppStore.getState().past.length
    useAppStore.getState().pasteCells3D()
    const after = useAppStore.getState()
    expect(after.floatContent).toBeNull()
    expect(after.model.color.get(encodeKey(5, 0, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(encodeKey(6, 0, 0))?.paletteSlot).toEqual(SLOT_B)
    expect(after.selectedCells).toEqual(frame)
    expect(after.past.length).toBe(strokesBefore + 1)
  })

  it('a mismatched empty selection floats instead of stamping', () => {
    paintAt([0, 0, 0], SLOT_A)
    paintAt([1, 0, 0], SLOT_B)
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    useAppStore.getState().copyCells3D()
    // 3-wide frame vs a 2-wide clipboard: no destination, so float in place.
    useAppStore.getState().setSelectedCells(new Set([encodeKey(5, 0, 0), encodeKey(6, 0, 0), encodeKey(7, 0, 0)]))
    useAppStore.getState().pasteCells3D()
    const after = useAppStore.getState()
    expect(after.floatContent).not.toBeNull()
    expect(after.model.color.size).toBe(2) // nothing written
  })

  it('pasteCells3D no-ops without clipboard content and without opening a stroke', () => {
    paintAt([0, 0, 0])
    // Clipboards survive newProject (cross-project paste), so clear explicitly.
    useAppStore.getState().setClipboard(null)
    expect(useAppStore.getState().clipboard).toBeNull()
    const before = useAppStore.getState().model
    const strokesBefore = useAppStore.getState().past.length
    useAppStore.getState().pasteCells3D()
    expect(useAppStore.getState().model).toBe(before)
    expect(useAppStore.getState().past.length).toBe(strokesBefore)
  })

  it('faceCells3D reports zeros with no selection, skips cubes silently', () => {
    expect(useAppStore.getState().faceCells3D()).toEqual({ faced: 0, skipped: 0 })
    paintAt([0, 0, 0])
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0)]))
    // Plain cube: nothing to face, silently ignored — same as faceSelection.
    expect(useAppStore.getState().faceCells3D()).toEqual({ faced: 0, skipped: 0 })
  })
})
