import { describe, expect, it, vi } from 'vitest'
import type { RigBox } from '@/engine/rigging/types'
import { rigWandTool } from './rigWandTool'
import type { ToolContext } from './types'

// z-plane, offset 0, orientation 1: logical (u,v) -> grid [u, -v-1, 0].
const PLANE = { axis: 'z', orientation: 1, offset: 0 } as const

const box = (id: string, min: [number, number, number], max: [number, number, number], parentId: string | null = null): RigBox => ({
  id, name: id, min, max, parentId, pivot: null,
})

function makeCtx(rigBoxes: RigBox[]) {
  return {
    ctx: {
      plane: PLANE,
      rigBoxes,
      selectedRigBoxId: null,
      selectRigBox: vi.fn(),
      translateRigBox: vi.fn(),
      animBeginStroke: vi.fn(),
      animCommitStroke: vi.fn(),
      applyRigBoxAt: vi.fn(),
      drag: { current: { kind: 'idle' } },
    } as unknown as ToolContext,
  }
}

const evt = (u: number, v: number) => ({ u, v, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })

describe('rigWandTool', () => {
  // Box 'a' over x∈[0,1], y∈[0,1]: display footprint u∈[0,2), v∈[-2,0).
  const boxes = [box('a', [0, 0, 0], [1, 1, 0])]

  it('selects on footprint tap and arms a move drag without creating', () => {
    const { ctx } = makeCtx(boxes)
    rigWandTool.onDown!(ctx, evt(0, -1))
    expect(ctx.selectRigBox).toHaveBeenCalledWith('a')
    expect(ctx.applyRigBoxAt).not.toHaveBeenCalled()
    expect(ctx.animBeginStroke).toHaveBeenCalledTimes(1)
    expect(ctx.drag.current).toEqual({ kind: 'rig-move', id: 'a', lastU: 0, lastV: -1 })
  })

  it('drags translate by the grid delta and commits one stroke on up', () => {
    const { ctx } = makeCtx(boxes)
    rigWandTool.onDown!(ctx, evt(0, -1))
    // (0,-1) -> grid (0,0,0); (1,-1) -> grid (1,0,0): delta [+1,0,0], offset axis pinned.
    rigWandTool.onMove!(ctx, evt(1, -1))
    expect(ctx.translateRigBox).toHaveBeenCalledWith('a', [1, 0, 0])
    expect(ctx.drag.current).toEqual({ kind: 'rig-move', id: 'a', lastU: 1, lastV: -1 })
    rigWandTool.onUp!(ctx, evt(1, -1))
    expect(ctx.drag.current).toEqual({ kind: 'idle' })
    expect(ctx.animCommitStroke).toHaveBeenCalledTimes(1)
  })

  it('creates a new box when the tap misses every footprint', () => {
    const { ctx } = makeCtx(boxes)
    rigWandTool.onDown!(ctx, evt(5, 5))
    expect(ctx.applyRigBoxAt).toHaveBeenCalledWith([5, -6, 0])
    expect(ctx.selectRigBox).not.toHaveBeenCalled()
    expect(ctx.drag.current).toEqual({ kind: 'idle' })
  })

  it('prefers the deeper box on overlapping footprints', () => {
    const nested = [box('p', [0, 0, 0], [2, 2, 0]), box('c', [0, 0, 0], [0, 0, 0], 'p')]
    const { ctx } = makeCtx(nested)
    rigWandTool.onDown!(ctx, evt(0, -1))
    expect(ctx.selectRigBox).toHaveBeenCalledWith('c')
  })
})
