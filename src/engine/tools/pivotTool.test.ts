import { describe, expect, it, vi } from 'vitest'
import type { RigBox } from '@/engine/rigging/types'
import { pivotTool } from './pivotTool'
import type { ToolContext } from './types'

// z-plane, offset 0, orientation 1: display (cu,cv) -> grid [cu-0.5, -cv-0.5, depth].
const PLANE = { axis: 'z', orientation: 1, offset: 0 } as const

function makeCtx(rigBoxes: RigBox[] = [], selectedRigBoxId: string | null = null) {
  return {
    ctx: {
      plane: PLANE,
      rigBoxes,
      selectedRigBoxId,
      setPivotForCurrentSlice: vi.fn(),
      setRigPivot: vi.fn(),
    } as unknown as ToolContext,
  } as const
}

const box = (id: string, pivot: RigBox['pivot']): RigBox => ({
  id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot,
})

const evt = (u: number, v: number, cu?: number, cv?: number) => ({ u, v, cu, cv, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })

describe('pivotTool', () => {
  it('falls back to the store path (toast) with nothing selected', () => {
    const { ctx } = makeCtx()
    pivotTool.onDown!(ctx, evt(1, 2, 1.5, 2.5))
    expect(ctx.setPivotForCurrentSlice).toHaveBeenCalledWith(1, 2)
    expect(ctx.setRigPivot).not.toHaveBeenCalled()
  })

  it('places on the 2x lattice under the cursor, keeping depth', () => {
    // Box center depth z=1; display (1.2,2.7) snaps to (1.0,2.5) → grid [0.5,-3,1].
    const { ctx } = makeCtx([box('a', null)], 'a')
    pivotTool.onDown!(ctx, evt(1, 2, 1.2, 2.7))
    expect(ctx.setRigPivot).toHaveBeenCalledWith('a', [0.5, -3, 1])
    expect(ctx.setPivotForCurrentSlice).not.toHaveBeenCalled()
  })

  it('lands cell centers exactly (centers are on the lattice too)', () => {
    const { ctx } = makeCtx([box('a', null)], 'a')
    pivotTool.onDown!(ctx, evt(1, 2, 1.5, 2.5))
    expect(ctx.setRigPivot).toHaveBeenCalledWith('a', [1, -3, 1])
  })

  it('keeps an explicitly set depth across placements', () => {
    const { ctx } = makeCtx([box('a', [9, 9, 9])], 'a')
    pivotTool.onDown!(ctx, evt(1, 2, 1.5, 2.5))
    expect(ctx.setRigPivot).toHaveBeenCalledWith('a', [1, -3, 9])
  })

  it('falls back to the clicked cell center without sub-cell position', () => {
    const { ctx } = makeCtx([box('a', null)], 'a')
    pivotTool.onDown!(ctx, evt(1, 2))
    expect(ctx.setRigPivot).toHaveBeenCalledWith('a', [1, -3, 1])
  })

  it('ignores altKey (no pin mode — spring and toolbar clicks are identical)', () => {
    const { ctx } = makeCtx([box('a', null)], 'a')
    pivotTool.onDown!(ctx, { ...evt(1, 2, 1.2, 2.7), altKey: true })
    expect(ctx.setRigPivot).toHaveBeenCalledWith('a', [0.5, -3, 1])
  })
})
