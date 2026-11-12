import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import { boxWorld, childBox } from '@/engine/grid/cellBox'
import type { SplitAxis, VoxelModel } from '@/engine/grid/types'
import type { ToolContext, ToolDragState } from '@/engine/tools/types'
import { moveTool } from '@/engine/tools/moveTool'
import { useAppStore } from './useAppStore'

/**
 * The Move tool follows the grid as displayed: it steps in half voxels along each in-plane axis
 * the grid cuts, and a slice move on a half-voxel stop moves only the plane's slab. z/1 plane:
 * logical u runs along +x, v along −y; pixel (0,-1) is voxel (0,0,offset).
 */

const A = { kind: 'base', index: 3 } as const
const g = () => useAppStore.getState()

/** Every occupied half-voxel unit (world half coords "hx,hy,hz") → slot index (+ "c" for chamfer). */
function halfUnits(model: VoxelModel): Map<string, string> {
  const out = new Map<string, string>()
  const fill = (lo: number[], size: number[], tag: string) => {
    for (let x = lo[0] * 2; x < (lo[0] + size[0]) * 2; x++)
      for (let y = lo[1] * 2; y < (lo[1] + size[1]) * 2; y++)
        for (let z = lo[2] * 2; z < (lo[2] + size[2]) * 2; z++) out.set(`${x},${y},${z}`, tag)
  }
  for (const [key, c] of model.color) {
    if (model.subdiv.has(key)) continue
    fill(decodeKey(key), [1, 1, 1], `${c.paletteSlot.index}${model.chamfer.has(key) ? 'c' : ''}`)
  }
  for (const [key, sub] of model.subdiv) {
    sub.children.forEach((child, i) => {
      if (!child) return
      const { origin, size } = boxWorld(decodeKey(key), childBox(sub.split, i))
      fill(origin, size, `${child.slot.index}`)
    })
  }
  return out
}

/** Half units of a world box given in half coordinates [lo, hi). */
function unitsOf(lo: [number, number, number], hi: [number, number, number], tag = `${A.index}`): Map<string, string> {
  const out = new Map<string, string>()
  for (let x = lo[0]; x < hi[0]; x++) for (let y = lo[1]; y < hi[1]; y++) for (let z = lo[2]; z < hi[2]; z++) out.set(`${x},${y},${z}`, tag)
  return out
}

const merge = (...maps: Array<Map<string, string>>) => new Map(maps.flatMap((m) => [...m]))

function paintWhole(u: number, v: number, offset = 0) {
  g().setGridSplit(null)
  g().setPlaneOffset(offset)
  g().beginStroke()
  g().paintCell(u, v)
  g().commitStroke()
}

beforeEach(() => {
  g().newProject('Move', 16)
  g().setMode('model')
  g().setPlaneAxisOrientation('z', 1)
  g().setPlaneOffset(0)
  g().setActiveVoxelKind('cube')
  g().setActivePaletteSlot(A)
  g().setSelection(null)
})

describe('Move tool follows the grid', () => {
  it('a slice move on a half-voxel stop moves only the plane’s slab', () => {
    paintWhole(0, -1) // voxel (0,0,0) → half units z 0..1
    g().setGridSplit(['z'])
    g().setPlaneHalf(1) // upper slab of layer 0
    g().beginMove(false)
    g().updateMove(1, 0) // whole voxel along +x (the grid doesn't cut x)
    g().endMove()
    expect(halfUnits(g().model)).toEqual(merge(unitsOf([0, 0, 0], [2, 2, 1]), unitsOf([2, 0, 1], [4, 2, 2])))
  })

  it('steps half a voxel in-plane when the grid cuts that axis', () => {
    paintWhole(0, -1)
    g().setGridSplit(['x'])
    g().beginMove(false)
    g().updateMove(1, 0) // one half step along +x
    g().endMove()
    expect(halfUnits(g().model)).toEqual(unitsOf([1, 0, 0], [3, 2, 2]))
  })

  it('steps half a voxel along v (−y on a z plane) when the grid cuts y', () => {
    paintWhole(0, -1)
    g().setGridSplit(['y'])
    g().beginMove(false)
    g().updateMove(0, 1) // +v runs −y
    g().endMove()
    expect(halfUnits(g().model)).toEqual(unitsOf([0, -1, 0], [2, 1, 2]))
  })

  it('a whole-model move takes every depth along in half steps', () => {
    paintWhole(0, -1, 0)
    paintWhole(0, -1, 3)
    g().setGridSplit(['x', 'y', 'z'])
    g().beginMove(true)
    g().updateMove(3, 0) // 1.5 voxels along +x
    g().endMove()
    expect(halfUnits(g().model)).toEqual(merge(unitsOf([3, 0, 0], [5, 2, 2]), unitsOf([3, 0, 6], [5, 2, 8])))
  })

  it('returning to the start restores the press-time model and records no undo step', () => {
    paintWhole(0, -1)
    g().setGridSplit(['x'])
    const before = g().model
    const past = g().past.length
    g().beginMove(false)
    g().updateMove(1, 0)
    expect(g().model).not.toBe(before)
    g().updateMove(0, 0)
    g().endMove()
    expect(g().model).toBe(before)
    expect(g().past.length).toBe(past)
  })

  it('dragging an empty slice records nothing', () => {
    paintWhole(0, -1, 2) // content on another layer only
    g().setPlaneOffset(0)
    const before = g().model
    const past = g().past.length
    g().beginMove(false)
    g().updateMove(3, 1)
    g().endMove()
    expect(g().model).toBe(before)
    expect(g().past.length).toBe(past)
  })

  it('a half-step move is one undo step', () => {
    paintWhole(0, -1)
    g().setGridSplit(['x'])
    const before = halfUnits(g().model)
    g().beginMove(false)
    g().updateMove(1, 0)
    g().updateMove(3, 0)
    g().endMove()
    expect(halfUnits(g().model)).toEqual(unitsOf([3, 0, 0], [5, 2, 2]))
    g().undo()
    expect(halfUnits(g().model)).toEqual(before)
  })

  it('content dragged off the volume comes back when dragged back within the gesture', () => {
    paintWhole(7, -1) // x = 7, the last column of a 16 volume
    g().setGridSplit(['x'])
    g().beginMove(false)
    g().updateMove(2, 0) // fully outside
    expect(g().model.color.size + g().model.subdiv.size).toBe(0)
    g().updateMove(1, 0) // half back inside
    expect(halfUnits(g().model)).toEqual(unitsOf([15, 0, 0], [16, 2, 2]))
    g().endMove()
  })

  it('whole bevels keep whole-voxel positions (the half step snaps)', () => {
    g().setActiveVoxelKind('ramp')
    paintWhole(0, -1)
    expect(g().model.chamfer.has(encodeKey(0, 0, 0))).toBe(true)
    g().setGridSplit(['x'])
    g().beginMove(false)
    g().updateMove(2, 0) // one whole voxel
    expect(g().model.chamfer.has(encodeKey(1, 0, 0))).toBe(true)
    g().updateMove(3, 0) // 1.5 voxels → snaps to a whole voxel, bevel intact
    const m = g().model
    expect(m.subdiv.size).toBe(0)
    expect([...m.chamfer.keys()]).toHaveLength(1)
    g().endMove()
  })

  it('leaves the other slab and other layers untouched on a slab move', () => {
    paintWhole(0, -1, 0)
    paintWhole(0, -1, 1)
    g().setGridSplit(['z'])
    g().setPlaneOffset(0)
    g().setPlaneHalf(0)
    g().beginMove(false)
    g().updateMove(-1, 0)
    g().endMove()
    expect(halfUnits(g().model)).toEqual(merge(
      unitsOf([-2, 0, 0], [0, 2, 1]), // moved lower slab of layer 0
      unitsOf([0, 0, 1], [2, 2, 2]), // its upper slab stays
      unitsOf([0, 0, 2], [2, 2, 4]), // layer 1 stays
    ))
  })
})

describe('Move tool handler measures the pointer in grid steps', () => {
  const ctxFor = (gridSplit: SplitAxis[] | null, updateMove: ReturnType<typeof vi.fn>) => {
    const drag = { current: { kind: 'idle' } as ToolDragState }
    return {
      plane: { axis: 'z', orientation: 1, offset: 0, half: null },
      gridSplit,
      drag,
      beginMove: vi.fn(),
      updateMove,
      endMove: vi.fn(),
    } as unknown as ToolContext
  }
  const evt = (u: number, v: number, cu: number, cv: number) => ({ u, v, cu, cv, button: 0, buttons: 1, shiftKey: false, altKey: false }) as never

  it('sends half steps when the grid cuts the in-plane axis', () => {
    const updateMove = vi.fn()
    const ctx = ctxFor(['x'], updateMove)
    moveTool.onDown!(ctx, evt(0, 0, 0.25, 0.5))
    moveTool.onMove!(ctx, evt(0, 0, 0.75, 0.5))
    expect(updateMove).toHaveBeenLastCalledWith(1, 0)
    moveTool.onMove!(ctx, evt(1, 0, 1.75, 0.5))
    expect(updateMove).toHaveBeenLastCalledWith(3, 0)
  })

  it('sends whole voxels under the whole grid and ignores sub-cell motion', () => {
    const updateMove = vi.fn()
    const ctx = ctxFor(null, updateMove)
    moveTool.onDown!(ctx, evt(0, 0, 0.25, 0.5))
    moveTool.onMove!(ctx, evt(0, 0, 0.75, 0.5))
    expect(updateMove).not.toHaveBeenCalled()
    moveTool.onMove!(ctx, evt(2, 0, 2.25, 0.5))
    expect(updateMove).toHaveBeenLastCalledWith(2, 0)
  })
})
