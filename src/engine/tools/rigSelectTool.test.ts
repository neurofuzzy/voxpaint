import { describe, expect, it, vi } from 'vitest'
import type { RigBox } from '@/engine/rigging/types'
import { rigSelectTool } from './rigSelectTool'
import type { ToolContext } from './types'

// z-plane, offset 0, orientation 1.
const PLANE = { axis: 'z', orientation: 1, offset: 0 } as const

function makeCtx(rigBoxes: RigBox[] = [], selectedRigBoxId: string | null = null) {
  return {
    ctx: {
      plane: PLANE,
      rigBoxes,
      selectedRigBoxId,
      selectRigBox: vi.fn(),
    } as unknown as ToolContext,
  } as const
}

const box = (id: string, min: [number, number, number], max: [number, number, number], parentId: string | null = null): RigBox => ({
  id, name: id, min, max, parentId, pivot: null,
})

describe('rigSelectTool', () => {
  it('selects the footprint under the cursor', () => {
    const { ctx } = makeCtx([box('a', [0, 0, 0], [0, 0, 0])])
    // Grid (0,0,0) on z ori 1 shows at logical (0,-1).
    rigSelectTool.onDown!(ctx, { u: 0, v: -1, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })
    expect(ctx.selectRigBox).toHaveBeenCalledWith('a')
  })

  it('prefers the deepest box on overlap', () => {
    const { ctx } = makeCtx([
      box('outer', [0, 0, 0], [2, 2, 2]),
      { ...box('inner', [0, 0, 0], [0, 0, 0]), parentId: 'outer' },
    ])
    rigSelectTool.onDown!(ctx, { u: 0, v: -1, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })
    expect(ctx.selectRigBox).toHaveBeenCalledWith('inner')
  })

  it('clears the selection on empty taps', () => {
    const { ctx } = makeCtx([box('a', [0, 0, 0], [0, 0, 0])], 'a')
    rigSelectTool.onDown!(ctx, { u: 9, v: 9, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })
    expect(ctx.selectRigBox).toHaveBeenCalledWith(null)
  })

  it('never boxes new regions on empty taps', () => {
    const { ctx } = makeCtx([])
    // No applyRigBoxAt on the context — would throw if called. Selection clears.
    rigSelectTool.onDown!(ctx, { u: 0, v: 0, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })
    expect(ctx.selectRigBox).toHaveBeenCalledWith(null)
  })
})
