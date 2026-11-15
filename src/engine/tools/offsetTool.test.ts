import { describe, expect, it, vi } from 'vitest'
import type { RigBox } from '@/engine/rigging/types'
import { offsetTool } from './offsetTool'
import type { ToolContext } from './types'

// z-plane, offset 0, orientation 1: logical (u,v) -> grid [u, -v-1, 0].
const PLANE = { axis: 'z', orientation: 1, offset: 0 } as const

const box = (id: string, min: [number, number, number], max: [number, number, number], parentId: string | null = null): RigBox => ({
  id, name: id, min, max, parentId, pivot: null,
})

function makeCtx(rigBoxes: RigBox[], keyOffsets: Record<string, [number, number, number]> = {}) {
  return {
    ctx: {
      plane: PLANE,
      rigBoxes,
      selectedRigBoxId: null,
      keyOffsets,
      selectRigBox: vi.fn(),
      beginOffsetMove: vi.fn().mockReturnValue(true),
      updateOffsetMove: vi.fn(),
      endOffsetMove: vi.fn(),
      drag: { current: { kind: 'idle' } },
    } as unknown as ToolContext,
  }
}

const evt = (u: number, v: number) => ({ u, v, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })

describe('offsetTool', () => {
  // Box 'a' over x∈[0,1], y∈[0,1]: display footprint u∈[0,2), v∈[-2,0).
  const boxes = [box('a', [0, 0, 0], [1, 1, 0])]

  it('selects on footprint tap and arms an offset drag', () => {
    const { ctx } = makeCtx(boxes)
    offsetTool.onDown!(ctx, evt(0, -1))
    expect(ctx.selectRigBox).toHaveBeenCalledWith('a')
    expect(ctx.beginOffsetMove).toHaveBeenCalledWith('a')
    expect(ctx.drag.current).toEqual({ kind: 'offset-move', id: 'a', startU: 0, startV: -1, startCu: 0.5, startCv: -0.5 })
  })

  it('drags pass the absolute grid delta and end the stroke on up', () => {
    const { ctx } = makeCtx(boxes)
    offsetTool.onDown!(ctx, evt(0, -1))
    // (0,-1) -> grid (0,0,0); (2,-1) -> grid (2,0,0): absolute delta [+2,0,0].
    offsetTool.onMove!(ctx, evt(1, -1))
    expect(ctx.updateOffsetMove).toHaveBeenCalledWith([1, 0, 0])
    offsetTool.onMove!(ctx, evt(2, -1))
    expect(ctx.updateOffsetMove).toHaveBeenCalledWith([2, 0, 0])
    offsetTool.onUp!(ctx, evt(2, -1))
    expect(ctx.drag.current).toEqual({ kind: 'idle' })
    expect(ctx.endOffsetMove).toHaveBeenCalledTimes(1)
  })

  it('stays idle when the offset gesture refuses to arm', () => {
    const { ctx } = makeCtx(boxes)
    vi.mocked(ctx.beginOffsetMove).mockReturnValue(false)
    offsetTool.onDown!(ctx, evt(0, -1))
    expect(ctx.selectRigBox).toHaveBeenCalledWith('a')
    expect(ctx.drag.current).toEqual({ kind: 'idle' })
  })

  it('ignores taps that miss every footprint', () => {
    const { ctx } = makeCtx(boxes)
    offsetTool.onDown!(ctx, evt(5, 5))
    expect(ctx.beginOffsetMove).not.toHaveBeenCalled()
    expect(ctx.drag.current).toEqual({ kind: 'idle' })
  })
})

describe('offsetTool fractional drag', () => {
  // Same box 'a' over x∈[0,1], y∈[0,1] on the z-plane.
  const boxes = [box('a', [0, 0, 0], [1, 1, 0])]
  const press = { u: 0, v: -1, cu: 0.5, cv: -0.5, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 }

  it('converts sub-cell pointer travel to fractional world deltas', () => {
    const { ctx } = makeCtx(boxes)
    offsetTool.onDown!(ctx, press)
    // Half a display cell right: +0.5 world x (z-plane: u -> +x).
    offsetTool.onMove!(ctx, { ...press, u: 1, cu: 1.0 })
    expect(ctx.updateOffsetMove).toHaveBeenCalledWith([0.5, 0, 0])
    // Quarter cell down in display v: world -y runs downward, so +0.25 display v = -0.25 y.
    offsetTool.onMove!(ctx, { ...press, u: 1, v: -1, cu: 1.0, cv: -0.25 })
    expect(ctx.updateOffsetMove).toHaveBeenCalledWith([0.5, -0.25, 0])
  })

  it('hit-tests the posed footprint, not the bind volume', () => {
    // Offset +1 in x shifts the footprint to display u∈[1,3): the old bind cell now misses.
    const { ctx } = makeCtx(boxes, { a: [1, 0, 0] })
    offsetTool.onDown!(ctx, evt(0, -1))
    expect(ctx.beginOffsetMove).not.toHaveBeenCalled()
    offsetTool.onDown!(ctx, evt(1, -1))
    expect(ctx.beginOffsetMove).toHaveBeenCalledWith('a')
  })
})
