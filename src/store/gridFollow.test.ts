import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { fineDivisionFor, fineRectRegion, forEachFineCell } from '@/engine/tools/fineSelection'
import { paintTool } from '@/engine/tools/paintTool'
import { selectTool } from '@/engine/tools/selectTool'
import type { LinePreview, ToolContext, ToolDragState } from '@/engine/tools/types'
import { useAppStore } from './useAppStore'

/**
 * Every edit and movement follows the grid as displayed: selections, lines, fills and slabs work
 * at the armed grid's resolution, never silently in whole voxels. z/1 plane: logical u runs +x,
 * v runs −y; pixel (0,-1) is voxel (0,0,0).
 */

const A = { kind: 'base', index: 3 } as const
const g = () => useAppStore.getState()
const plane = (): ConstructionPlane => ({ axis: 'z', orientation: 1, offset: 0, half: null })
const evt = (u: number, v: number, cu: number, cv: number, mods: { shiftKey?: boolean; altKey?: boolean } = {}) =>
  ({ u, v, cu, cv, button: 0, buttons: 1, shiftKey: false, altKey: false, ...mods }) as never

beforeEach(() => {
  g().newProject('Grid', 16)
  g().setMode('model')
  g().setPlaneAxisOrientation('z', 1)
  g().setPlaneOffset(0)
  g().setActiveVoxelKind('cube')
  g().setActivePaletteSlot(A)
  g().setSelection(null)
  g().setGridSplit(null)
})

describe('lasso selects at the grid’s resolution', () => {
  it('traces half cells when the grid cuts an in-plane axis', () => {
    const setSelection = vi.fn()
    const drag = { current: { kind: 'idle' } as ToolDragState }
    const ctx = {
      model: emptyModel(), plane: plane(), gridExtent: 16, gridSplit: ['x'], selection: null, floatContent: null, floatOrigin: null,
      drag, setSelection, setSelectPreview: vi.fn(), bakeFloatIfAny: vi.fn(),
    } as unknown as ToolContext
    // A box path from fine u 0 to fine u 3 (cell 0's x-low half to cell 1's x-high half).
    selectTool.onDown!(ctx, evt(0, -1, 0.25, -0.5, { altKey: true }))
    for (const [u, v, cu, cv] of [[1, -1, 1.75, -0.5], [1, 3, 1.75, 3.5], [0, 3, 0.25, 3.5], [0, -1, 0.25, -0.5]] as const) {
      selectTool.onMove!(ctx, evt(u, v, cu, cv, { altKey: true }))
    }
    selectTool.onUp!(ctx, evt(0, -1, 0.25, -0.5))
    const region = setSelection.mock.calls.at(-1)![0]
    expect(region.fine).toMatchObject({ su: 2, sv: 1 })
    const us = new Set<number>()
    forEachFineCell(region, (fu) => us.add(fu))
    // The lasso's own edge rule, on half cells: cell 0 whole plus only the x-low half of cell 1.
    expect([...us].sort()).toEqual([0, 1, 2])
  })
})

describe('shift-lines follow the grid', () => {
  function lineCtx(gridSplit: ['x'] | null) {
    const paintCell = vi.fn()
    let preview: LinePreview | null = null
    const drag = { current: { kind: 'idle' } as ToolDragState }
    const ctx = {
      plane: plane(), gridSplit, drag, paintCell,
      get linePreview() { return preview },
      setLinePreview: (p: LinePreview | null) => { preview = p },
      bakeFloatIfAny: vi.fn(), beginStroke: vi.fn(), commitStroke: vi.fn(), correctChamferStroke: vi.fn(),
    } as unknown as ToolContext
    return { ctx, paintCell, preview: () => preview }
  }

  it('2D: the preview and the write run on half cells', () => {
    const { ctx, paintCell, preview } = lineCtx(['x'])
    paintTool.onDown!(ctx, evt(0, 0, 0.75, 0.5, { shiftKey: true })) // fine u 1
    paintTool.onMove!(ctx, evt(2, 0, 2.25, 0.5, { shiftKey: true })) // fine u 4
    expect(preview()?.fine).toMatchObject({ su: 2, sv: 1, anchor: [1, 0], end: [4, 0] })
    paintTool.onUp!(ctx, evt(2, 0, 2.25, 0.5))
    expect(paintCell.mock.calls.map((c) => c.slice(0, 3))).toEqual([[0, 0, 1], [1, 0, 0], [1, 0, 1], [2, 0, 0]])
  })

  it('2D: the whole grid keeps whole-cell lines', () => {
    const { ctx, preview } = lineCtx(null)
    paintTool.onDown!(ctx, evt(0, 0, 0.75, 0.5, { shiftKey: true }))
    paintTool.onMove!(ctx, evt(2, 0, 2.25, 0.5, { shiftKey: true }))
    expect(preview()).toEqual({ anchor: [0, 0], end: [2, 0] })
  })

  it('3D: a shift-tap line paints the grid cells between the two taps', () => {
    g().setGridSplit(['x'])
    g().beginStroke()
    g().paintLineAtCoord([0, 0, 0], false, [1, 0, 0]) // x-high half of voxel 0
    g().commitStroke()
    g().beginStroke()
    g().paintLineAtCoord([2, 0, 0], true, [0, 0, 0]) // x-low half of voxel 2
    g().commitStroke()
    const m = g().model
    expect(m.subdiv.get(encodeKey(0, 0, 0))?.children).toEqual([null, { slot: A }])
    expect(m.color.has(encodeKey(1, 0, 0))).toBe(true) // both halves → folded whole
    expect(m.subdiv.get(encodeKey(2, 0, 0))?.children).toEqual([{ slot: A }, null])
  })
})

describe('the plane’s slab', () => {
  it('a sub-voxel selection follows the plane to the other half', () => {
    g().setGridSplit(['z'])
    g().setPlaneHalf(1)
    const p = g().plane
    g().setSelection(fineRectRegion(fineDivisionFor(p, g().gridSplit), 0, -1, 0, -1))
    expect(g().selection?.fine?.slab).toBe(1)
    g().stepPlaneHalf(-1)
    expect(g().plane.half).toBe(0)
    expect(g().selection?.fine?.slab).toBe(0)
    g().setPlaneHalf(1)
    expect(g().selection?.fine?.slab).toBe(1)
  })

  it('switching the plane’s half bakes a pending float first', () => {
    g().beginStroke()
    g().paintCell(0, -1)
    g().commitStroke()
    g().setGridSplit(['z'])
    g().setPlaneHalf(1)
    g().setSelection(fineRectRegion(fineDivisionFor(g().plane, g().gridSplit), 0, -1, 0, -1))
    g().liftSelectionToFloat()
    expect(g().floatContent).not.toBeNull()
    g().setPlaneHalf(0)
    expect(g().floatContent).toBeNull()
  })

  it('select-all then delete on a half-voxel stop removes only the plane’s slab', () => {
    g().beginStroke()
    g().paintCell(0, -1)
    g().paintCell(3, 2)
    g().commitStroke()
    g().setGridSplit(['z'])
    g().setPlaneHalf(1)
    g().setSelection({ originU: -8, originV: -8, width: 16, height: 16, mask: new Uint8Array(256).fill(1) })
    g().deleteSelection()
    const m = g().model
    expect(m.color.size).toBe(0)
    expect(m.subdiv.get(encodeKey(0, 0, 0))?.children).toEqual([{ slot: A }, null])
  })

  it('copy of a whole-cell selection on a half stop copies the slab only', () => {
    g().beginStroke()
    g().paintCell(0, -1)
    g().commitStroke()
    g().setGridSplit(['z'])
    g().setPlaneHalf(0)
    g().setSelection({ originU: 0, originV: -1, width: 1, height: 1, mask: new Uint8Array([1]) })
    g().copySelection()
    const clip = g().clipboard!
    expect(clip.fine?.slab).toBe(0)
    expect(clip.cells[0].subdiv?.children).toEqual([{ slot: A }, null])
  })
})

describe('window-select double-click floods at grid resolution', () => {
  it('selects the tapped half’s color-connected sub-cells on the slice', () => {
    g().setGridSplit(['x'])
    g().beginStroke()
    g().paintCell(0, -1, 1, 0) // x-high half of voxel 0
    g().paintCell(1, -1, 0, 0) // x-low half of voxel 1
    g().commitStroke()
    g().setLayoutMode?.('split')
    g().applySliceWandAt([0, 0, 0], false, [1, 0, 0])
    const sel = g().selection!
    expect(sel.fine).toMatchObject({ su: 2, sv: 1 })
    const cells: number[] = []
    forEachFineCell(sel, (fu) => cells.push(fu))
    expect(cells.sort()).toEqual([1, 2])
  })
})

describe('face selection reaches detail bevels', () => {
  it('counts a beveled grid cell under the selection', () => {
    g().setGridSplit(['x', 'y', 'z'])
    g().setActiveVoxelKind('convex')
    g().beginStroke()
    g().paintCell(0, -1, 0, 0)
    g().commitStroke()
    expect([...g().model.subdiv.get(encodeKey(0, 0, 0))!.children].some((c) => c?.chamfer)).toBe(true)
    const { u, v } = pixelFromGridCoord(g().plane, [0, 0, 0])
    g().setSelection({ originU: u, originV: v, width: 1, height: 1, mask: new Uint8Array([1]) })
    const { faced, skipped } = g().faceSelection()
    expect(faced + skipped).toBe(1)
  })
})

describe('fill leak guard', () => {
  it('rejects a leaking fill on an odd-sized project too', () => {
    g().newProject('Odd', 15)
    g().setPlaneAxisOrientation('z', 1)
    g().setPlaneOffset(0)
    g().setActivePaletteSlot(A)
    g().floodFill(0, 0)
    expect(g().model.color.size).toBe(0)
  })
})
