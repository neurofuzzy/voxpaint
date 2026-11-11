import { describe, expect, it, vi } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import { advanceSplit, coarsenCell, remapChildren, scaffoldCell, subdivideCell } from '@/engine/grid/subdiv'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { ToolContext } from './types'
import { subdivideTool } from './subdivideTool'

const PLANE: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0, half: null }
const DUMMY_SLOT = { kind: 'base', index: 0 } as const

function makeCtx() {
  const calls: Array<[u: number, v: number, alt: boolean | undefined]> = []
  const ctx = {
    model: { color: new Map(), chamfer: new Map(), subdiv: new Map(), bounds: null },
    plane: PLANE,
    gridExtent: 16,
    pendingSplit: ['x', 'y'] as Array<'x' | 'y' | 'z'>,
    bakeFloatIfAny: vi.fn(),
    beginStroke: vi.fn(),
    commitStroke: vi.fn(),
    // Records routing; the store owns the split/scaffold/cycle semantics (covered in
    // paintActions.test.ts). Applying divisions mutates the fake model so drag dedupe works.
    toggleSubdivide: (u: number, v: number, alt?: boolean) => {
      calls.push([u, v, alt])
      const coord = gridCoordFromPixel(PLANE, u, v)
      const key = encodeKey(...coord)
      const FULL = ['x', 'y', 'z'] as Array<'x' | 'y' | 'z'>
      const sub = ctx.model.subdiv.get(key)
      const applySplit = (split: Array<'x' | 'y' | 'z'>) => {
        if (!sub) return
        const prev = sub.split
        sub.split = [...split]
        sub.children = remapChildren(prev, sub.children, [...split])
      }
      if (alt) {
        // Alt forces full as a momentary override (never adopts).
        if (sub) {
          if (sub.split.join() !== 'x,y,z') applySplit(FULL)
        } else if (ctx.model.color.has(key)) subdivideCell(ctx.model, coord, FULL)
        else scaffoldCell(ctx.model, coord, FULL, { ...DUMMY_SLOT })
      } else if (!sub) {
        if (ctx.model.color.has(key)) subdivideCell(ctx.model, coord, [...(ctx.pendingSplit ?? [])])
        else scaffoldCell(ctx.model, coord, [...(ctx.pendingSplit ?? [])], { ...DUMMY_SLOT })
      } else if (!ctx.pendingSplit) {
        coarsenCell(ctx.model, coord)
      } else {
        // Taps cycle the voxel's own family regardless of the toolbar selection.
        const next = advanceSplit(sub.split, PLANE.axis)
        if (next === null) coarsenCell(ctx.model, coord)
        else applySplit(next)
      }
      return true
    },
    drag: { current: { kind: 'idle' } },
  } as unknown as ToolContext
  return { ctx, calls }
}

function paintCube(ctx: ToolContext, u: number, v: number) {
  ctx.model.color.set(encodeKey(...gridCoordFromPixel(PLANE, u, v)), { paletteSlot: { kind: 'base', index: 0 } })
}

const evt = (u: number, v: number) => ({ u, v, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })
const evtAlt = (u: number, v: number) => ({ ...evt(u, v), altKey: true })

describe('subdivideTool', () => {
  it('tap on a plain cube splits with the pending division', () => {
    const { ctx, calls } = makeCtx()
    paintCube(ctx, 2, 3)
    subdivideTool.onDown!(ctx, evt(2, 3))
    subdivideTool.onUp!(ctx, evt(2, 3))
    expect(calls).toEqual([[2, 3, false]])
  })

  it('tap on empty space scaffolds with the pending division', () => {
    const { ctx, calls } = makeCtx()
    subdivideTool.onDown!(ctx, evt(4, 4))
    subdivideTool.onUp!(ctx, evt(4, 4))
    expect(calls).toEqual([[4, 4, false]])
    const sub = ctx.model.subdiv.get(encodeKey(...gridCoordFromPixel(PLANE, 4, 4)))
    expect(sub?.scaffold).toBe(true)
    expect(sub?.split).toEqual(['x', 'y'])
  })

  it('Alt tap forces the full 8-way split', () => {
    const { ctx, calls } = makeCtx()
    paintCube(ctx, 1, 1)
    subdivideTool.onDown!(ctx, evtAlt(1, 1))
    subdivideTool.onUp!(ctx, evtAlt(1, 1))
    expect(calls[0][2]).toBe(true)
  })

  it('tap on a subdivided cell advances within its family, Alt forces 8', () => {
    const { ctx, calls } = makeCtx()
    paintCube(ctx, 2, 3)
    subdivideCell(ctx.model, gridCoordFromPixel(PLANE, 2, 3), ['y', 'z'])
    // Plain tap: no explicit split — the store advances the voxel's family division
    // (quarters YZ → XZ on the z-plane) without touching the toolbar.
    subdivideTool.onDown!(ctx, evt(2, 3))
    subdivideTool.onUp!(ctx, evt(2, 3))
    expect(calls[0][2]).toBe(false)
    expect(ctx.model.subdiv.get(encodeKey(...gridCoordFromPixel(PLANE, 2, 3)))!.split).toEqual(['x', 'z'])
    expect(ctx.pendingSplit).toEqual(['x', 'y'])
    // Alt tap: explicit full split.
    const { ctx: ctx2, calls: calls2 } = makeCtx()
    paintCube(ctx2, 2, 3)
    subdivideCell(ctx2.model, gridCoordFromPixel(PLANE, 2, 3), ['x'])
    subdivideTool.onDown!(ctx2, evtAlt(2, 3))
    subdivideTool.onUp!(ctx2, evtAlt(2, 3))
    expect(calls2[0][2]).toBe(true)
  })

  it('drag splits every plain cube entered, once each, with the pending split', () => {
    const { ctx, calls } = makeCtx()
    for (const u of [0, 1, 2]) paintCube(ctx, u, 0)
    subdivideTool.onDown!(ctx, evt(0, 0))
    // Re-entering the anchor must not double-apply (dedupe by cell visited this gesture).
    subdivideTool.onMove!(ctx, evt(1, 0))
    subdivideTool.onMove!(ctx, evt(1, 0))
    subdivideTool.onMove!(ctx, evt(2, 0))
    subdivideTool.onUp!(ctx, evt(2, 0))
    // The anchor applies on first move (a drag starting on a plain cube splits it too).
    expect(calls.map(([u, v]) => [u, v])).toEqual([[0, 0], [1, 0], [2, 0]])
    for (const [, , alt] of calls) expect(alt).toBe(false)
  })

  it('drag scaffolds empty cells but still skips chamfered ones', () => {
    const { ctx, calls } = makeCtx()
    paintCube(ctx, 0, 0)
    ctx.model.chamfer.set(encodeKey(...gridCoordFromPixel(PLANE, 1, 0)), { planeAxis: 'z', planeOrientation: 1, resolvedTo: null })
    subdivideTool.onDown!(ctx, evt(0, 0))
    // The anchor applies on first move; chamfered cells are skipped, empty cells scaffold.
    subdivideTool.onMove!(ctx, evt(1, 0)) // chamfered — skipped
    subdivideTool.onMove!(ctx, evt(1, 1)) // empty — scaffolded
    subdivideTool.onUp!(ctx, evt(1, 1))
    expect(calls.map(([u, v]) => [u, v])).toEqual([[0, 0], [1, 1]])
    const sub = ctx.model.subdiv.get(encodeKey(...gridCoordFromPixel(PLANE, 1, 1)))
    expect(sub?.scaffold).toBe(true)
  })

  it('brackets one undo stroke per gesture', () => {
    const { ctx } = makeCtx()
    paintCube(ctx, 0, 0)
    paintCube(ctx, 1, 0)
    subdivideTool.onDown!(ctx, evt(0, 0))
    subdivideTool.onMove!(ctx, evt(1, 0))
    subdivideTool.onUp!(ctx, evt(2, 0))
    expect(ctx.bakeFloatIfAny).toHaveBeenCalledTimes(1)
    expect(ctx.beginStroke).toHaveBeenCalledTimes(1)
    expect(ctx.commitStroke).toHaveBeenCalledTimes(1)
  })
})
