import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Coord, VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { useAppStore } from '@/store/useAppStore'
import { floodFillOccupied3D } from './floodFill'
import { wandSelectionForComponent, wandTool } from './wandTool'
import type { ToolContext } from './types'

const PLANE: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0 }
const SLOT_A = { kind: 'base', index: 0 } as PaletteSlotRef
const SLOT_B = { kind: 'base', index: 3 } as PaletteSlotRef

function paintBox(model: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, slot: PaletteSlotRef = SLOT_A) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) model.color.set(encodeKey(x, y, z), { paletteSlot: { ...slot } })
}

function emptyModel(): VoxelModel {
  return { color: new Map(), chamfer: new Map(), bounds: null }
}

describe('floodFillOccupied3D', () => {
  it('collects the touching component across colors and depths, excluding the disconnected', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 1, 1, 1, SLOT_A) // 2x2x2, one cell recolored
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { ...SLOT_B } })
    paintBox(model, 5, 5, 5, 5, 5, 5) // disconnected loner
    const found = floodFillOccupied3D(model, [1, 1, 1], 16)
    expect(found).toHaveLength(8)
    expect(found).not.toContain(encodeKey(5, 5, 5))
  })

  it('does not leak diagonally (6-connected only)', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 0, 0, 0)
    paintBox(model, 1, 1, 0, 1, 1, 0) // diagonal touch only
    expect(floodFillOccupied3D(model, [0, 0, 0], 16)).toEqual([encodeKey(0, 0, 0)])
  })

  it('returns empty from an empty start instead of throwing', () => {
    expect(floodFillOccupied3D(emptyModel(), [0, 0, 0], 16)).toEqual([])
  })
})

describe('wandSelectionForComponent', () => {
  it('occupied: bbox footprint of the whole touching component plus the anchor', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 2, 1, 3, SLOT_B) // mixed colors, 3 deep
    const found = wandSelectionForComponent(model, PLANE, [1, 1, 2], 16, 'occupied')
    expect(found?.anchor).toEqual([1, 1, 2])
    // z-plane: u=x, v spans −y — footprint covers x 0..2 and the y range either way.
    expect(found?.region.width).toBe(3)
    expect(found?.region.height).toBe(2)
    expect(found?.region.mask).toEqual(new Uint8Array(6).fill(1))
  })

  it('color: bbox of only the start cell color', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 2, 0, 0, SLOT_A)
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: { ...SLOT_B } }) // middle cell differs
    const found = wandSelectionForComponent(model, PLANE, [0, 0, 0], 16, 'color')
    // Only the two SLOT_A ends connect through… they don't (B splits them): lone start cell.
    expect(found?.region.width).toBe(1)
    expect(found?.region.height).toBe(1)
    const both = wandSelectionForComponent(model, PLANE, [0, 0, 0], 16, 'occupied')
    expect(both?.region.width).toBe(3)
  })

  it('mask covers only flooded cells, leaving bbox holes empty', () => {
    const model = emptyModel()
    // L-shape: the bbox corner (0,-2) in (u,v) holds no flooded cell.
    paintBox(model, 0, 0, 0, 0, 0, 0)
    paintBox(model, 1, 0, 0, 1, 0, 0)
    paintBox(model, 1, 1, 0, 1, 1, 0)
    const found = wandSelectionForComponent(model, PLANE, [0, 0, 0], 16, 'occupied')
    expect(found?.region.originU).toBe(0)
    expect(found?.region.originV).toBe(-2)
    expect(found?.region.width).toBe(2)
    expect(found?.region.height).toBe(2)
    expect(found?.region.mask).toEqual(new Uint8Array([0, 1, 1, 1]))
  })

  it('returns null for an empty start cell', () => {
    expect(wandSelectionForComponent(emptyModel(), PLANE, [0, 0, 0], 16, 'occupied')).toBeNull()
  })
})

describe('wandTool (2D pointer half)', () => {
  function makeCtx() {
    const calls: { at: Coord[] } = { at: [] }
    const ctx = {
      plane: PLANE,
      applyWandAt: (cell: Coord) => { calls.at.push(cell) },
    } as unknown as ToolContext
    return { ctx, calls }
  }

  // (u,v) -> grid on the z=0 plane: u=x, v maps to −y (corner-anchored); (0,0) hits cell (0,-1,0).
  const evt = (u: number, v: number) => ({ u, v, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })

  it('delegates the click cell to the two-stage store action (no drag state)', () => {
    const { ctx, calls } = makeCtx()
    wandTool.onDown!(ctx, evt(0, 0))
    expect(calls.at).toEqual([[0, -1, 0]])
    // Atomic click: no move/up handling, no preview state.
    expect(wandTool.onMove).toBeUndefined()
    expect(wandTool.onUp).toBeUndefined()
  })
})

describe('wand store round-trip (anchor + component delete)', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setLayoutMode('split')
  })

  function paintAt(coord: Coord, slot: PaletteSlotRef = SLOT_A) {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('cube')
    s.setActivePaletteSlot(slot)
    s.beginStroke()
    expect(s.paintCellAtCoord(coord, 'z', 1)).toBe(true)
    s.commitStroke()
  }

  it('setWandSelection stores region + anchor; setSelection clears the anchor', () => {
    paintAt([0, 0, 0])
    paintAt([1, 0, 0])
    // NB: re-fetch — the `s` snapshot predates the paints.
    const live = useAppStore.getState()
    const found = wandSelectionForComponent(live.model, live.plane, [0, 0, 0] as Coord, live.meta.gridExtent, 'occupied')
    expect(found).not.toBeNull()
    useAppStore.getState().setWandSelection(found!.region, { cell: found!.anchor, match: 'occupied' })
    expect(useAppStore.getState().wandAnchor).toEqual({ cell: [0, 0, 0], match: 'occupied' })
    expect(useAppStore.getState().selection).not.toBeNull()
    // Any fresh selection reverts to plain semantics.
    useAppStore.getState().setSelection(found!.region)
    expect(useAppStore.getState().wandAnchor).toBeNull()
  })

  it('deleteSelection with a live anchor erases the whole component at every depth', () => {
    // Two-deep column plus a same-slice neighbor in another color, plus an unrelated loner.
    paintAt([0, 0, 0])
    paintAt([0, 0, 1])
    paintAt([1, 0, 0], SLOT_B)
    paintAt([5, 5, 5])
    const found = wandSelectionForComponent(useAppStore.getState().model, PLANE, [0, 0, 0] as Coord, 16, 'occupied')
    useAppStore.getState().setWandSelection(found!.region, { cell: found!.anchor, match: 'occupied' })
    useAppStore.getState().deleteSelection()
    const after = useAppStore.getState()
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(0, 0, 1))).toBe(false)
    expect(after.model.color.has(encodeKey(1, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(5, 5, 5))).toBe(true)
    // Anchor consumed: the region survives as a plain selection.
    expect(after.wandAnchor).toBeNull()
    expect(after.selection).not.toBeNull()
  })

  it('deleteSelection after a color tap removes only the color set at every depth', () => {
    // A-column two deep, B-neighbor same slice: first tap is color-connected.
    paintAt([0, 0, 0], SLOT_A)
    paintAt([0, 0, 1], SLOT_A)
    paintAt([1, 0, 0], SLOT_B)
    useAppStore.getState().setActiveTool('wand')
    useAppStore.getState().applyWandAt([0, 0, 0])
    expect(useAppStore.getState().wandAnchor).toEqual({ cell: [0, 0, 0], match: 'color' })
    useAppStore.getState().deleteSelection()
    const after = useAppStore.getState()
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(0, 0, 1))).toBe(false)
    // The other color survives even though it sat inside the bbox.
    expect(after.model.color.has(encodeKey(1, 0, 0))).toBe(true)
    expect(after.wandAnchor).toBeNull()
  })

  it('deleteSelection without an anchor keeps slice semantics', () => {
    paintAt([0, 0, 0])
    paintAt([0, 0, 1])
    const s = useAppStore.getState()
    const found = wandSelectionForComponent(s.model, PLANE, [0, 0, 0] as Coord, s.meta.gridExtent, 'occupied')
    // Plain (non-wand) selection: anchor stays null even though a region is set.
    s.setSelection(found!.region)
    expect(useAppStore.getState().wandAnchor).toBeNull()
    useAppStore.getState().deleteSelection()
    const after = useAppStore.getState()
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
    // Other depths untouched by the slice delete.
    expect(after.model.color.has(encodeKey(0, 0, 1))).toBe(true)
  })

  it('deleteSelection with a stale (now empty) anchor falls back to the slice', () => {
    paintAt([0, 0, 0])
    paintAt([0, 0, 1])
    const s = useAppStore.getState()
    const found = wandSelectionForComponent(s.model, PLANE, [0, 0, 0] as Coord, s.meta.gridExtent, 'occupied')
    useAppStore.getState().setWandSelection(found!.region, { cell: found!.anchor, match: 'occupied' })
    // Erase the anchor cell directly: the component is gone, the anchor is stale.
    useAppStore.getState().eraseCellAtCoord([0, 0, 0])
    expect(useAppStore.getState().model.color.has(encodeKey(0, 0, 0))).toBe(false)
    useAppStore.getState().deleteSelection()
    // Slice fallback: footprint cleared on the active slice, other depths intact.
    expect(useAppStore.getState().model.color.has(encodeKey(0, 0, 1))).toBe(true)
  })
})

describe('applyWandAt two-stage timing', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setLayoutMode('split')
    vi.useFakeTimers()
    // Jump far past any prior click so every test starts at the color stage.
    vi.setSystemTime(Date.now() + 60_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function paintRow() {
    paintAtHere([0, 0, 0], SLOT_A)
    paintAtHere([1, 0, 0], SLOT_B) // touching, different color
    paintAtHere([5, 5, 5], SLOT_A) // disconnected loner
  }

  function paintAtHere(coord: Coord, slot: PaletteSlotRef = SLOT_A) {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('cube')
    s.setActivePaletteSlot(slot)
    s.beginStroke()
    expect(s.paintCellAtCoord(coord, 'z', 1)).toBe(true)
    s.commitStroke()
  }

  it('first click selects the color-connected region and stays on the wand', () => {
    paintRow()
    useAppStore.getState().setActiveTool('wand')
    useAppStore.getState().applyWandAt([0, 0, 0])
    const after = useAppStore.getState()
    expect(after.selection?.width).toBe(1) // lone SLOT_A cell
    expect(after.selection?.height).toBe(1)
    expect(after.wandAnchor).toEqual({ cell: [0, 0, 0], match: 'color' })
    // No handoff: the wand stays active so a rapid re-tap expands instead of marquees.
    expect(after.activeTool).toBe('wand')
  })

  it('re-click within a second expands to the whole occupied component', () => {
    paintRow()
    useAppStore.getState().applyWandAt([0, 0, 0])
    vi.advanceTimersByTime(500)
    useAppStore.getState().applyWandAt([0, 0, 0])
    const after = useAppStore.getState()
    expect(after.selection?.width).toBe(2) // both touching cells, either color
    expect(after.wandAnchor).toEqual({ cell: [0, 0, 0], match: 'occupied' })
    expect(after.activeTool).toBe('wand')
  })

  it('fast tap on the same component in another color expands from the new cell', () => {
    paintRow()
    useAppStore.getState().applyWandAt([0, 0, 0])
    vi.advanceTimersByTime(500)
    useAppStore.getState().applyWandAt([1, 0, 0])
    const after = useAppStore.getState()
    expect(after.selection?.width).toBe(2)
    expect(after.wandAnchor).toEqual({ cell: [1, 0, 0], match: 'occupied' })
  })

  it('fast tap on a disconnected chunk restarts at color instead of expanding', () => {
    paintRow()
    useAppStore.getState().applyWandAt([0, 0, 0])
    vi.advanceTimersByTime(500)
    useAppStore.getState().applyWandAt([5, 5, 5])
    const after = useAppStore.getState()
    // The loner's own color set — not merged into the previous component.
    expect(after.selection?.width).toBe(1)
    expect(after.selection?.height).toBe(1)
    expect(after.wandAnchor).toEqual({ cell: [5, 5, 5], match: 'color' })
  })

  it('a slow second click restarts at color', () => {    paintRow()
    useAppStore.getState().applyWandAt([0, 0, 0])
    vi.advanceTimersByTime(1500)
    useAppStore.getState().applyWandAt([1, 0, 0])
    // SLOT_B loner-in-color (neighbor differs): 1x1, not the component.
    expect(useAppStore.getState().selection?.width).toBe(1)
    expect(useAppStore.getState().wandAnchor).toEqual({ cell: [1, 0, 0], match: 'color' })
  })

  it('empty click clears and resets the stage', () => {
    paintRow()
    useAppStore.getState().applyWandAt([0, 0, 0])
    useAppStore.getState().applyWandAt([3, 3, 3]) // empty, fast — clears
    const cleared = useAppStore.getState()
    expect(cleared.selection).toBeNull()
    expect(cleared.wandAnchor).toBeNull()
    // Stage reset: next click is color again even though fast.
    vi.advanceTimersByTime(500)
    useAppStore.getState().applyWandAt([1, 0, 0])
    expect(useAppStore.getState().selection?.width).toBe(1)
  })
})
