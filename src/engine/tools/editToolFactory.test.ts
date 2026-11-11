import { describe, expect, it, vi } from 'vitest'
import { interpolateStrokePoints } from './editToolFactory'
import { paintTool } from './paintTool'
import type { ToolContext } from './types'

const q = (u: number, v: number, qu: number | null, qv: number | null) => ({
  u,
  v,
  quad: qu === null || qv === null ? null : ([qu, qv] as [number, number]),
})

describe('interpolateStrokePoints', () => {
  it('walks every quadrant inside one cell on a diagonal micro-drag', () => {
    const pts = interpolateStrokePoints(q(0, 0, 0, 0), q(0, 0, 1, 1))
    // Doubled (0,0)->(1,1): (0,0),(1,1) → two quadrant visits in the same cell.
    expect(pts).toEqual([
      { u: 0, v: 0, quad: [0, 0] },
      { u: 0, v: 0, quad: [1, 1] },
    ])
  })

  it('crosses cells with the right quadrants on a horizontal drag', () => {
    const pts = interpolateStrokePoints(q(0, 0, 1, 0), q(2, 0, 0, 1))
    // Doubled (1,0)->(4,1), Bresenham: (1,0),(2,0),(3,1),(4,1) → cells/quadrants:
    expect(pts).toEqual([
      { u: 0, v: 0, quad: [1, 0] },
      { u: 1, v: 0, quad: [0, 0] },
      { u: 1, v: 0, quad: [1, 1] },
      { u: 2, v: 0, quad: [0, 1] },
    ])
  })

  it('applies a tap (same point) exactly once', () => {
    expect(interpolateStrokePoints(q(3, 4, 1, 0), q(3, 4, 1, 0))).toEqual([{ u: 3, v: 4, quad: [1, 0] }])
  })

  it('falls back to whole-cell points when either end lacks fractions', () => {
    const pts = interpolateStrokePoints(q(0, 0, null, null), q(1, 0, null, null))
    expect(pts.every((p) => p.quad === null)).toBe(true)
    expect(pts.map((p) => [p.u, p.v])).toEqual([[0, 0], [1, 0]])
  })

  it('never repeats a (cell, quadrant) visit', () => {
    const pts = interpolateStrokePoints(q(-2, -1, 0, 1), q(1, 2, 1, 0))
    const keys = pts.map((p) => `${p.u},${p.v},${p.quad}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('paintTool quadrant wiring', () => {
  function makeCtx() {
    const painted: Array<[number, number, number | undefined, number | undefined]> = []
    const ctx = {
      model: { color: new Map(), chamfer: new Map(), subdiv: new Map(), bounds: null },
      plane: { axis: 'z' as const, orientation: 1 as const, offset: 0 },
      bakeFloatIfAny: vi.fn(),
      beginStroke: vi.fn(),
      commitStroke: vi.fn(),
      correctChamferStroke: vi.fn(),
      paintCell: (u: number, v: number, qu?: number, qv?: number) => { painted.push([u, v, qu, qv]); return true },
      setLinePreview: vi.fn(),
      drag: { current: { kind: 'idle' } },
    } as unknown as ToolContext
    return { ctx, painted }
  }
  const evt = (u: number, v: number, cu?: number, cv?: number) => ({
    u, v, cu, cv, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1,
  })

  it('forwards the hovered quadrant to paintCell', () => {
    const { ctx, painted } = makeCtx()
    paintTool.onDown!(ctx, evt(2, 3, 2.75, 3.75))
    paintTool.onUp!(ctx, evt(2, 3, 2.75, 3.75))
    // z-plane orientation 1: display == logical quadrants (no mirrors).
    expect(painted).toEqual([[2, 3, 1, 1]])
  })

  it('passes no quadrant for fractionless (synthetic) events', () => {
    const { ctx, painted } = makeCtx()
    paintTool.onDown!(ctx, evt(2, 3))
    paintTool.onUp!(ctx, evt(2, 3))
    expect(painted).toEqual([[2, 3, undefined, undefined]])
  })

  it('dedupes intra-cell moves, re-firing only on quadrant change', () => {
    const { ctx, painted } = makeCtx()
    paintTool.onDown!(ctx, evt(2, 3, 2.1, 3.1)) // quadrant (0,0)
    paintTool.onMove!(ctx, evt(2, 3, 2.2, 3.2)) // same quadrant — no-op
    paintTool.onMove!(ctx, evt(2, 3, 2.8, 3.2)) // quadrant (1,0) — fires (plus the line start, re-applied as before)
    paintTool.onMove!(ctx, evt(2, 3, 2.9, 3.3)) // same quadrant — no-op
    paintTool.onUp!(ctx, evt(2, 3, 2.9, 3.3))
    expect(painted).toEqual([[2, 3, 0, 0], [2, 3, 0, 0], [2, 3, 1, 0]])
  })
})
