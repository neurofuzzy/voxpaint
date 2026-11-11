import { describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import { subdivideCell } from '@/engine/grid/subdiv'
import type { ChamferCell, ChamferShapeKind } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { VoxelKind } from '@/store/types'
import { eyedropperTool, voxelKindForCell } from './eyedropperTool'
import type { ToolContext } from './types'

const SLOT = { kind: 'base', index: 2 } as const
const PLANE: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0, half: null }

function makeCtx() {
  const calls: { slots: unknown[]; kinds: VoxelKind[]; tools: string[] } = { slots: [], kinds: [], tools: [] }
  const ctx = {
    model: { color: new Map(), chamfer: new Map(), subdiv: new Map(), bounds: null },
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

  it('maps ramp to ramp', () => {
    expect(voxelKindForCell({ planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } })).toBe('ramp')
  })

  it('maps an unresolved chamfer cell to ramp', () => {
    expect(voxelKindForCell({ planeAxis: 'z', planeOrientation: 1, resolvedTo: null })).toBe('ramp')
  })

  it('maps every other resolved shape to its own kind', () => {
    for (const shapeKind of ['convex', 'concave', 'wedge', 'thin', 'half', 'post', 'quarter', 'flat', 'flatwedge'] as const) {
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

  it('picks the explicit corner kind from a convex autotile voxel', () => {
    const { ctx, calls } = makeCtx()
    paintVoxel(ctx, 0, 0, { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'convex', rotation: 1 } })
    eyedropperTool.onDown!(ctx, evt(0, 0))
    expect(calls.kinds).toEqual(['convex'])
    expect(calls.tools).toEqual(['paint'])
  })

  it('does nothing on an empty cell', () => {
    const { ctx, calls } = makeCtx()
    eyedropperTool.onDown!(ctx, evt(4, 4))
    expect(calls.slots).toEqual([])
    expect(calls.kinds).toEqual([])
    expect(calls.tools).toEqual([])
  })

  it('samples the hovered quadrant of subdivided detail (front child first)', () => {
    const { ctx, calls } = makeCtx()
    // z-plane orientation 1: display == logical quadrants (no mirrors), logical (u,v) frame
    // has uDir=+x, vDir=-y, viewer on +z — so display quadrant (0,0) is the (x-lo, y-hi)
    // quarter: front octant 6 (dx=0,dy=1,dz=1), back octant 2 (dx=0,dy=1,dz=0).
    const coord = gridCoordFromPixel(PLANE, 0, 0)
    ctx.model.color.set(encodeKey(...coord), { paletteSlot: { kind: 'base', index: 0 } })
    subdivideCell(ctx.model, coord)
    const sub = ctx.model.subdiv.get(encodeKey(...coord))!
    const metal = { kind: 'metal', index: 1 } as const
    sub.children[6] = { slot: metal }
    const withFrac = { ...evt(0, 0), cu: 0.25, cv: 0.25 }
    eyedropperTool.onDown!(ctx, withFrac)
    expect(calls.slots).toEqual([metal])
    expect(calls.kinds).toEqual(['cube'])
    expect(calls.tools).toEqual(['paint'])
  })

  it('samples a frozen detail bevel kind like a full-size cell', () => {
    const { ctx, calls } = makeCtx()
    const coord = gridCoordFromPixel(PLANE, 0, 0)
    ctx.model.color.set(encodeKey(...coord), { paletteSlot: { kind: 'base', index: 0 } })
    subdivideCell(ctx.model, coord)
    const sub = ctx.model.subdiv.get(encodeKey(...coord))!
    sub.children[6] = {
      slot: { kind: 'base', index: 0 },
      chamfer: { planeAxis: 'y', planeOrientation: 1, resolvedTo: { shapeKind: 'convex', rotation: 1 } },
    }
    eyedropperTool.onDown!(ctx, { ...evt(0, 0), cu: 0.25, cv: 0.25 })
    expect(calls.slots).toEqual([{ kind: 'base', index: 0 }])
    expect(calls.kinds).toEqual(['convex'])
  })

  it('falls back to the back child, then the parent slot', () => {
    const { ctx, calls } = makeCtx()
    const coord = gridCoordFromPixel(PLANE, 0, 0)
    ctx.model.color.set(encodeKey(...coord), { paletteSlot: { kind: 'base', index: 0 } })
    subdivideCell(ctx.model, coord)
    const sub = ctx.model.subdiv.get(encodeKey(...coord))!
    const glass = { kind: 'glass', index: 0 } as const
    sub.children[6] = null
    sub.children[2] = { slot: glass }
    eyedropperTool.onDown!(ctx, { ...evt(0, 0), cu: 0.25, cv: 0.25 })
    expect(calls.slots).toEqual([glass])
    // No continuous position: samples the stored parent slot.
    sub.children[2] = null
    eyedropperTool.onDown!(ctx, evt(0, 0))
    expect(calls.slots).toEqual([glass, { kind: 'base', index: 0 }])
  })
})
