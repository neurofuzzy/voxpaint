import { describe, expect, it, vi } from 'vitest'
import { emptyModel } from '@/engine/grid/GridStore'
import type { ConstructionPlane } from '@/engine/plane/types'
import { fineDivisionFor, fineRectRegion } from './fineSelection'
import { selectTool } from './selectTool'
import type { ToolContext, ToolDragState } from './types'

const plane = (): ConstructionPlane => ({ axis: 'z', orientation: 1, offset: 0, half: null })

function mockCtx(overrides: Partial<ToolContext> & { dragState: { current: ToolDragState } }): ToolContext {
  return {
    model: emptyModel(),
    plane: plane(),
    gridExtent: 32,
    activeVoxelKind: 'cube',
    activePaletteSlot: { kind: 'base', index: 0 },
    selection: null,
    gridSplit: ['x'],
    floatContent: null,
    floatOrigin: null,
    clipboard: null,
    drag: overrides.dragState,
    setActiveTool: vi.fn(),
    setSelection: vi.fn(),
    setSelectPreview: vi.fn(),
    setSelectedCells: vi.fn(),
    applyWandAt: vi.fn(),
    applyRigBoxAt: vi.fn(),
    liftSelectionToFloat: vi.fn(),
    moveFloatTo: vi.fn(),
    moveFloatCellsTo: vi.fn(),
    transformFloat: vi.fn(),
    bakeFloatIfAny: vi.fn(),
    beginStroke: vi.fn(),
    commitStroke: vi.fn(),
    ...overrides,
  } as unknown as ToolContext
}

const evt = (u: number, v: number, cu: number, cv: number) =>
  ({ u, v, cu, cv, button: 0, buttons: 1, shiftKey: false, altKey: false }) as never

describe('selectTool sub-voxel float drag', () => {
  it('tracks fine units on the lift gesture itself, before any re-render refreshes the context', () => {
    // Grid x armed: su=2. Selection covers fine u 2..3 (right half of cell 1 + left half of cell 2).
    const p = plane()
    const selection = fineRectRegion(fineDivisionFor(p, ['x']), 2, 0, 3, 0)
    const dragState = { current: { kind: 'idle' } as ToolDragState }
    const moveFloatTo = vi.fn()
    // NOTE: floatContent stays null the whole gesture — the lift's render hasn't flushed,
    // exactly what the tool sees when the pointer keeps moving within the same frame.
    const ctx = mockCtx({ dragState, selection, moveFloatTo, gridSplit: ['x'] })

    // Press in the right half of cell 1 (fine unit 3), then drag into cell 2's left half (fine 4).
    selectTool.onDown!(ctx, evt(1, 0, 1.75, 0.5))
    expect(ctx.liftSelectionToFloat).toHaveBeenCalled()
    expect(dragState.current.kind).toBe('moveFloat')

    selectTool.onMove!(ctx, evt(2, 0, 2.25, 0.5))
    // One fine unit over: same whole origin, sub-cell offset 1 — not a whole-voxel jump to (2,0).
    expect(moveFloatTo).toHaveBeenCalledWith(1, 0, 1, 0)
  })

  it('still steps whole voxels when the lifted content holds a chamfer', () => {
    const p = plane()
    const selection = fineRectRegion(fineDivisionFor(p, ['x']), 2, 0, 3, 0)
    const dragState = { current: { kind: 'idle' } as ToolDragState }
    const moveFloatTo = vi.fn()
    const ctx = mockCtx({ dragState, selection, moveFloatTo, gridSplit: ['x'] })

    selectTool.onDown!(ctx, evt(1, 0, 1.75, 0.5))
    // Empty model: nothing chamfered, so the recorded step is non-atomic…
    const drag = dragState.current
    expect(drag.kind).toBe('moveFloat')
    if (drag.kind === 'moveFloat') expect(drag.fineStep).toEqual({ su: 2, sv: 1 })

    selectTool.onMove!(ctx, evt(1, 0, 1.75, 0.5))
    expect(moveFloatTo).toHaveBeenCalledWith(1, 0, 0, 0)
  })
})

describe('selectTool float drags step at the grid, whatever the content', () => {
  it('a whole-cell selection drags in half voxels with a grid armed', () => {
    const selection = { originU: 1, originV: 0, width: 1, height: 1, mask: new Uint8Array([1]) }
    const dragState = { current: { kind: 'idle' } as ToolDragState }
    const moveFloatTo = vi.fn()
    const ctx = mockCtx({ dragState, selection, moveFloatTo, gridSplit: ['x'] })
    selectTool.onDown!(ctx, evt(1, 0, 1.25, 0.5))
    selectTool.onMove!(ctx, evt(1, 0, 1.75, 0.5))
    expect(moveFloatTo).toHaveBeenLastCalledWith(1, 0, 1, 0)
    selectTool.onMove!(ctx, evt(2, 0, 2.25, 0.5))
    expect(moveFloatTo).toHaveBeenLastCalledWith(2, 0, 0, 0)
  })

  it('a whole grid drags whole voxels and keeps the float’s half-voxel offset', () => {
    const selection = { originU: 1, originV: 0, width: 1, height: 1, mask: new Uint8Array([1]) }
    const dragState = { current: { kind: 'idle' } as ToolDragState }
    const moveFloatTo = vi.fn()
    const ctx = mockCtx({
      dragState, selection, moveFloatTo, gridSplit: null,
      floatContent: { width: 1, height: 1, cells: [{ du: 0, dv: 0, dw: 0, color: { paletteSlot: { kind: 'base', index: 0 } } }] },
      floatOrigin: { originU: 1, originV: 0, subU: 1 },
    })
    selectTool.onDown!(ctx, evt(1, 0, 1.5, 0.5))
    selectTool.onMove!(ctx, evt(3, 0, 3.5, 0.5))
    expect(moveFloatTo).toHaveBeenLastCalledWith(3, 0, 1, undefined)
  })
})

