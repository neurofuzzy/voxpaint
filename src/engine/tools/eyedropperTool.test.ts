import { describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { ChamferCell, ChamferShapeKind } from '@/engine/grid/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { VoxelKind } from '@/store/types'
import { eyedropperTool, voxelKindForCell } from './eyedropperTool'
import type { ToolContext } from './types'

const SLOT = { kind: 'base', index: 2 } as const
const PLANE = { axis: 'z' as const, orientation: 1 as const, offset: 0 }

function makeCtx() {
  const calls: { slots: unknown[]; kinds: VoxelKind[]; tools: string[] } = { slots: [], kinds: [], tools: [] }
  const ctx = {
    model: { color: new Map(), chamfer: new Map(), bounds: null },
    plane: PLANE,
    setActivePaletteSlot: (slot: unknown) => { calls.slots.push(slot) },
    setActiveVoxelKind: (kind: VoxelKind) => { calls.kinds.push(kind) },
    setActiveTool: (tool: string) => { calls.tools.push(tool) },
  } as unknown as ToolContext
  return { ctx, calls }
}

function paintVoxel(ctx: ToolContext, u: number, v: number, chamfer?: ChamferCell) {
  const coord = gridCoordFromPixel(PLANE, u, v)
  const key = encodeKey(...coord)
  ctx.model.color.set(key, { paletteSlot: { ...SLOT } })
  if (chamfer) ctx.model.chamfer.set(key, chamfer)
  return key
}

const evt = (u: number, v: number) => ({ u, v, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })

describe('voxelKindForCell', () => {
  it('maps plain cubes (no chamfer entry) to cube', () => {
    expect(voxelKindForCell(undefined)).toBe('cube')
  })

  it('maps the ramp autotile family to ramp', () => {
    for (const shapeKind of ['ramp', 'convex', 'concave'] as const) {
      expect(voxelKindForCell({ planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind, rotation: 0 } })).toBe('ramp')
    }
  })

  it('maps an unresolved chamfer cell to ramp', () => {
    expect(voxelKindForCell({ planeAxis: 'z', planeOrientation: 1, resolvedTo: null })).toBe('ramp')
  })

  it('maps every other resolved shape to its own kind', () => {
    for (const shapeKind of ['wedge', 'thin', 'half', 'post', 'quarter', 'flat', 'flatwedge'] as const) {
      expect(
        voxelKindForCell({ planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind, rotation: 0 } }),
      ).toBe(shapeKind)
    }
  })
})

describe('eyedropperTool', () => {
  it('picks the slot and cube kind from a plain voxel, then switches to paint', () => {
    const { ctx, calls } = makeCtx()
    paintVoxel(ctx, 2, 3)
    eyedropperTool.onDown!(ctx, evt(2, 3))
    expect(calls.slots).toEqual([{ ...SLOT }])
    expect(calls.kinds).toEqual(['cube'])
    expect(calls.tools).toEqual(['paint'])
  })

  it('picks the wedge kind from a wedge voxel', () => {
    const { ctx, calls } = makeCtx()
    const shapeKind: ChamferShapeKind = 'wedge'
    paintVoxel(ctx, 1, 1, { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind, rotation: 2 } })
    eyedropperTool.onDown!(ctx, evt(1, 1))
    expect(calls.slots).toEqual([{ ...SLOT }])
    expect(calls.kinds).toEqual(['wedge'])
    expect(calls.tools).toEqual(['paint'])
  })

  it('picks ramp from a convex autotile voxel', () => {
    const { ctx, calls } = makeCtx()
    paintVoxel(ctx, 0, 0, { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'convex', rotation: 1 } })
    eyedropperTool.onDown!(ctx, evt(0, 0))
    expect(calls.kinds).toEqual(['ramp'])
    expect(calls.tools).toEqual(['paint'])
  })

  it('does nothing on an empty cell', () => {
    const { ctx, calls } = makeCtx()
    eyedropperTool.onDown!(ctx, evt(4, 4))
    expect(calls.slots).toEqual([])
    expect(calls.kinds).toEqual([])
    expect(calls.tools).toEqual([])
  })
})
