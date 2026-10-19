import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Coord, VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { useAppStore } from '@/store/useAppStore'
import { floodFillOccupied3D, floodFillRegion3D } from './floodFill'
import { regionForFloodedCells, wandTool } from './wandTool'
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

describe('regionForFloodedCells', () => {
  it('builds the bbox footprint with an exact-cell mask', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 2, 1, 3, SLOT_B) // mixed colors, 3 deep
    const keys = floodFillOccupied3D(model, [1, 1, 2], 16)
    const region = regionForFloodedCells(PLANE, keys)
    // z-plane: u=x, v spans −y — footprint covers x 0..2 and the y range either way.
    expect(region.width).toBe(3)
    expect(region.height).toBe(2)
    expect(region.mask).toEqual(new Uint8Array(6).fill(1))
  })

  it('mask covers only flooded cells, leaving bbox holes empty', () => {
    // L-shape: the bbox corner (0,-2) in (u,v) holds no flooded cell.
    const keys = [encodeKey(0, 0, 0), encodeKey(1, 0, 0), encodeKey(1, 1, 0)]
    const region = regionForFloodedCells(PLANE, keys)
    expect(region.originU).toBe(0)
    expect(region.originV).toBe(-2)
    expect(region.width).toBe(2)
    expect(region.height).toBe(2)
    expect(region.mask).toEqual(new Uint8Array([0, 1, 1, 1]))
  })

  it('color floods stay within one palette slot', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 2, 0, 0, SLOT_A)
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: { ...SLOT_B } }) // middle cell differs
    // B splits the row: the color flood from the end is a lone cell…
    expect(floodFillRegion3D(model, [0, 0, 0], 16)).toEqual([encodeKey(0, 0, 0)])
    // …while occupancy takes all three.
    expect(floodFillOccupied3D(model, [0, 0, 0], 16)).toHaveLength(3)
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

describe('applyWandAt per layout', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setLayoutMode('split')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    vi.useFakeTimers()
    // Jump far past any prior click so every test starts at the color stage.
    vi.setSystemTime(Date.now() + 60_000)
    // Deterministic stage reset that no clock gaming can defeat: an empty click clears the
    // two-stage timing module state (fake-time jumps cluster across tests, so time alone
    // cannot isolate them).
    useAppStore.getState().applyWandAt([7, 7, 7])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function paintAt(coord: Coord, slot: PaletteSlotRef = SLOT_A) {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('cube')
    s.setActivePaletteSlot(slot)
    s.beginStroke()
    expect(s.paintCellAtCoord(coord, 'z', 1)).toBe(true)
    s.commitStroke()
  }

  function paintRow() {
    paintAt([0, 0, 0], SLOT_A)
    paintAt([1, 0, 0], SLOT_B) // touching, different color
    paintAt([5, 5, 5], SLOT_A) // disconnected loner
  }

  function cells(): Set<string> {
    return useAppStore.getState().selectedCells
  }

  it('split: first click writes the footprint region, 3D set stays empty', () => {
    paintRow()
    useAppStore.getState().setActiveTool('wand')
    useAppStore.getState().applyWandAt([0, 0, 0])
    const after = useAppStore.getState()
    expect(after.selection?.width).toBe(1) // lone SLOT_A cell
    expect(after.selection?.height).toBe(1)
    expect(after.selectedCells.size).toBe(0)
    // No handoff: the wand stays active so a rapid re-tap expands instead of marquees.
    expect(after.activeTool).toBe('wand')
  })

  it('split: rapid re-tap widens the footprint region, 3D set stays empty', () => {
    paintRow()
    useAppStore.getState().applyWandAt([0, 0, 0])
    vi.advanceTimersByTime(500)
    useAppStore.getState().applyWandAt([0, 0, 0])
    const after = useAppStore.getState()
    expect(after.selection?.width).toBe(2) // both touching cells, either color
    expect(after.selectedCells.size).toBe(0)
  })

  it('split: empty tap clears the region', () => {
    paintRow()
    useAppStore.getState().applyWandAt([0, 0, 0])
    useAppStore.getState().applyWandAt([3, 3, 3]) // empty, fast — clears
    expect(useAppStore.getState().selection).toBeNull()
  })

  it('split: slice delete clears the footprint slice only', () => {
    paintAt([0, 0, 0])
    paintAt([0, 0, 1])
    useAppStore.getState().applyWandAt([0, 0, 0])
    useAppStore.getState().deleteSelection()
    const after = useAppStore.getState()
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
    // Other depths untouched by the slice delete.
    expect(after.model.color.has(encodeKey(0, 0, 1))).toBe(true)
  })

  it('3d-only: first click writes the color set, 2D selection stays empty', () => {
    paintRow()
    useAppStore.getState().setLayoutMode('3d-only')
    useAppStore.getState().setActiveTool('wand')
    useAppStore.getState().applyWandAt([0, 0, 0])
    const after = useAppStore.getState()
    expect(after.selectedCells).toEqual(new Set([encodeKey(0, 0, 0)]))
    expect(after.selection).toBeNull()
    expect(after.activeTool).toBe('wand')
  })

  it('3d-only: rapid re-tap writes the occupied set', () => {
    paintRow()
    useAppStore.getState().setLayoutMode('3d-only')
    useAppStore.getState().applyWandAt([0, 0, 0])
    vi.advanceTimersByTime(500)
    useAppStore.getState().applyWandAt([1, 0, 0])
    expect(cells()).toEqual(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    expect(useAppStore.getState().selection).toBeNull()
  })

  it('3d-only: fast disconnected tap restarts at color', () => {
    paintRow()
    useAppStore.getState().setLayoutMode('3d-only')
    useAppStore.getState().applyWandAt([0, 0, 0])
    vi.advanceTimersByTime(500)
    useAppStore.getState().applyWandAt([5, 5, 5])
    // The loner's own color set — not merged into the previous component.
    expect(cells()).toEqual(new Set([encodeKey(5, 5, 5)]))
  })

  it('3d-only: slow tap restarts at color', () => {
    paintRow()
    useAppStore.getState().setLayoutMode('3d-only')
    useAppStore.getState().applyWandAt([0, 0, 0])
    vi.advanceTimersByTime(1500)
    useAppStore.getState().applyWandAt([1, 0, 0])
    // SLOT_B loner-in-color (neighbor differs): just itself, not the component.
    expect(cells()).toEqual(new Set([encodeKey(1, 0, 0)]))
  })

  it('3d-only: empty tap clears the 3D set and resets the stage', () => {
    paintRow()
    useAppStore.getState().setLayoutMode('3d-only')
    useAppStore.getState().applyWandAt([0, 0, 0])
    useAppStore.getState().applyWandAt([3, 3, 3]) // empty, fast — clears
    expect(useAppStore.getState().selectedCells.size).toBe(0)
    // Stage reset: next click is color again even though fast.
    vi.advanceTimersByTime(500)
    useAppStore.getState().applyWandAt([1, 0, 0])
    expect(cells()).toEqual(new Set([encodeKey(1, 0, 0)]))
  })
})
