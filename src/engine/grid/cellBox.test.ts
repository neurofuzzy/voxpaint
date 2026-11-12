import { describe, expect, it } from 'vitest'
import type { ChamferCell, Coord, DetailChild } from './types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { emptyModel, encodeKey } from './GridStore'
import {
  bevelFitsBox,
  boxFromOriginSize,
  boxWorld,
  childBits,
  childBox,
  childIndex,
  childInBox,
  contentAtBox,
  exactChildIndex,
  faceHitBits,
  gridBox,
  gridBoxAtBits,
  normalizeCell,
  readCellDetail,
  recolorBox,
  refineChildren,
  worldBitsFromQuad,
  writeBox,
  WHOLE_BOX,
  type CellBox,
} from './cellBox'

const A: PaletteSlotRef = { kind: 'base', index: 1 }
const B: PaletteSlotRef = { kind: 'base', index: 2 }
const RAMP: ChamferCell = { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } }
const at: Coord = [2, 3, 0]
const key = encodeKey(...at)

function modelWithCube(slot = A) {
  const m = emptyModel()
  m.color.set(key, { paletteSlot: slot })
  return m
}

describe('box math', () => {
  it('childBits/childIndex round-trip and childBox names the child', () => {
    for (const split of [[], ['x'], ['y', 'z'], ['x', 'y', 'z']] as const) {
      for (let i = 0; i < 2 ** split.length; i++) {
        expect(childIndex([...split], childBits([...split], i))).toBe(i)
        expect(childInBox([...split], i, childBox([...split], i))).toBe(true)
      }
    }
  })

  it('boxWorld / boxFromOriginSize are inverses', () => {
    const box: CellBox = [1, null, 0]
    const { origin, size } = boxWorld(at, box)
    expect(origin).toEqual([2.5, 3, 0])
    expect(size).toEqual([0.5, 1, 0.5])
    expect(boxFromOriginSize([origin[0] - at[0], origin[1] - at[1], origin[2] - at[2]], size)).toEqual(box)
  })

  it('gridBox: whole grid is the whole voxel; cut axes take the slab / pointer half', () => {
    const plane: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0, half: null }
    expect(gridBox(plane, null, [1, 1, 1])).toEqual(WHOLE_BOX)
    // Cut in-plane axis without a pointer spans it; with one it takes the pointer half.
    expect(gridBox(plane, ['x'], null)).toEqual([null, null, null])
    expect(gridBox(plane, ['x'], [1, 0, 0])).toEqual([1, null, null])
    // The plane axis takes the plane's slab (viewer side when not on a half stop).
    expect(gridBox(plane, ['z'], [1, 1, 0])).toEqual([null, null, 1])
    expect(gridBox({ ...plane, half: 0 }, ['x', 'y', 'z'], [0, 1, 1])).toEqual([0, 1, 0])
    expect(gridBoxAtBits(['y'], [1, 0, 1])).toEqual([null, 0, null])
  })

  it('worldBitsFromQuad folds the plane basis signs', () => {
    // Round-trip against gridBox on every axis: the quadrant's half lands on the u/v world axes.
    for (const axis of ['x', 'y', 'z'] as const) {
      const bits = worldBitsFromQuad({ axis }, 1, 0)
      expect(bits.filter((b) => b === 1).length).toBeLessThanOrEqual(2)
    }
  })

  it('faceHitBits nudges inside the clicked face', () => {
    // A hit on the +x face of (2,3,0) at x=3 belongs to the high-x half.
    expect(faceHitBits([3, 3.7, 0.2], at, 'x', 1)).toEqual([1, 1, 0])
    // A hit on the -x face at x=2 belongs to the low-x half.
    expect(faceHitBits([2, 3.2, 0.9], at, 'x', -1)).toEqual([0, 0, 1])
  })
})

describe('writeBox', () => {
  it('a whole box writes a plain voxel and replaces any detail', () => {
    const m = modelWithCube()
    writeBox(m, at, [1, null, null], { slot: B })
    expect(m.subdiv.has(key)).toBe(true)
    writeBox(m, at, WHOLE_BOX, { slot: A })
    expect(m.subdiv.has(key)).toBe(false)
    expect(m.color.get(key)).toEqual({ paletteSlot: A })
  })

  it('splits just far enough and keeps the rest of the voxel', () => {
    const m = modelWithCube()
    writeBox(m, at, [1, null, null], { slot: B })
    const sub = m.subdiv.get(key)!
    expect(sub.split).toEqual(['x'])
    expect(sub.children).toEqual([{ slot: A }, { slot: B }])
    expect(m.color.has(key)).toBe(false)
  })

  it('erasing a box carves it; erasing the rest deletes the voxel', () => {
    const m = modelWithCube()
    writeBox(m, at, [null, null, 1], null)
    expect(m.subdiv.get(key)!.children).toEqual([{ slot: A }, null])
    writeBox(m, at, [null, null, 0], null)
    expect(m.subdiv.has(key)).toBe(false)
    expect(m.color.has(key)).toBe(false)
  })

  it('folds back to one voxel when the write restores uniformity (no redundant splits)', () => {
    const m = modelWithCube()
    writeBox(m, at, [0, null, null], { slot: A })
    expect(m.subdiv.has(key)).toBe(false)
    expect(m.color.get(key)).toEqual({ paletteSlot: A })
    writeBox(m, at, [0, null, null], { slot: B })
    writeBox(m, at, [1, null, null], { slot: B })
    expect(m.subdiv.has(key)).toBe(false)
    expect(m.color.get(key)).toEqual({ paletteSlot: B })
  })

  it('folds only the axes that are uniform', () => {
    const m = modelWithCube()
    writeBox(m, at, [0, 0, null], { slot: B })
    writeBox(m, at, [0, 1, null], { slot: B })
    // Both x-low quarters are B: the y cut no longer carries detail.
    expect(m.subdiv.get(key)!.split).toEqual(['x'])
    expect(m.subdiv.get(key)!.children).toEqual([{ slot: B }, { slot: A }])
  })

  it('writes empty space without leaving a scaffold', () => {
    const m = emptyModel()
    writeBox(m, at, [null, 1, null], { slot: A })
    expect(m.subdiv.get(key)).toEqual({ split: ['y'], children: [null, { slot: A }] })
    writeBox(m, at, [0, 0, 0], null)
    expect(m.subdiv.get(key)).toEqual({ split: ['y'], children: [null, { slot: A }] })
  })

  it('re-splits a finer request without losing the existing detail', () => {
    const m = modelWithCube()
    writeBox(m, at, [null, 1, null], { slot: B })
    writeBox(m, at, [0, 0, null], null)
    const sub = m.subdiv.get(key)!
    expect(sub.split).toEqual(['x', 'y'])
    // x0y0 erased; x1y0 still A; both y1 children still B.
    expect(sub.children).toEqual([null, { slot: A }, { slot: B }, { slot: B }])
  })

  it('a bevel occupies exactly its box when the voxel can hold it as one child', () => {
    const m = modelWithCube()
    writeBox(m, at, [1, null, null], { slot: B, chamfer: RAMP })
    const sub = m.subdiv.get(key)!
    expect(sub.split).toEqual(['x'])
    expect(sub.children[1]).toEqual({ slot: B, chamfer: RAMP })
    expect(exactChildIndex(m, at, [1, null, null])).toBe(1)
    expect(contentAtBox(m, at, [1, null, null])).toEqual({ slot: B, chamfer: RAMP })
  })

  it('a bevel merges a finer split back when the content outside the box allows it', () => {
    const m = modelWithCube()
    // Split xy, but only the x-high half carries detail: a ramp in x-low can coarsen y away.
    writeBox(m, at, [1, 0, null], { slot: B })
    writeBox(m, at, [1, 1, null], { slot: B })
    expect(bevelFitsBox(m, at, [0, null, null])).toBe(true)
    writeBox(m, at, [0, null, null], { slot: A, chamfer: RAMP })
    expect(m.subdiv.get(key)!.split).toEqual(['x'])
    expect(m.subdiv.get(key)!.children[0]).toEqual({ slot: A, chamfer: RAMP })
  })

  it('a bevel lands as a plain block when the voxel is cut finer outside the box', () => {
    const m = modelWithCube()
    writeBox(m, at, [1, 0, null], { slot: B }) // x-high is split along y (A over B)
    expect(bevelFitsBox(m, at, [0, null, null])).toBe(false)
    writeBox(m, at, [0, null, null], { slot: A, chamfer: RAMP })
    const sub = m.subdiv.get(key)!
    expect(sub.children.some((c) => c?.chamfer)).toBe(false)
  })

  it('cutting a bevel turns it into a plain block, never duplicated smaller bevels', () => {
    const m = modelWithCube()
    writeBox(m, at, [1, null, null], { slot: B, chamfer: RAMP })
    // A finer write in the other half re-splits along y: the ramp is cut.
    writeBox(m, at, [0, 1, null], null)
    const sub = m.subdiv.get(key)!
    expect(sub.children.filter((c) => c?.chamfer)).toHaveLength(0)
    expect(sub.children.filter((c) => c?.slot.index === B.index)).toHaveLength(2)
  })

  it('refineChildren drops bevels only on children the new split cuts', () => {
    const children: (DetailChild | null)[] = [{ slot: A, chamfer: RAMP }, null]
    expect(refineChildren(['x'], children, ['x'])).toEqual(children)
    expect(refineChildren(['x'], children, ['x', 'y'])).toEqual([{ slot: A }, null, { slot: A }, null])
  })

  it('partially overwriting a whole chamfer cell keeps the rest as a plain block', () => {
    const m = modelWithCube()
    m.chamfer.set(key, RAMP)
    writeBox(m, at, [null, null, 1], { slot: B })
    expect(m.chamfer.has(key)).toBe(false)
    expect(m.subdiv.get(key)!.children).toEqual([{ slot: A }, { slot: B }])
  })
})

describe('recolorBox', () => {
  it('recolors part of a plain voxel by splitting, never adding volume', () => {
    const m = emptyModel()
    expect(recolorBox(m, at, [1, null, null], B)).toBe(false)
    expect(m.subdiv.size + m.color.size).toBe(0)
    m.color.set(key, { paletteSlot: A })
    expect(recolorBox(m, at, [1, null, null], B)).toBe(true)
    expect(m.subdiv.get(key)!.children).toEqual([{ slot: A }, { slot: B }])
  })

  it('recolors a whole chamfer cell instead of cutting its bevel', () => {
    const m = modelWithCube()
    m.chamfer.set(key, RAMP)
    expect(recolorBox(m, at, [1, null, null], B)).toBe(true)
    expect(m.color.get(key)).toEqual({ paletteSlot: B })
    expect(m.chamfer.get(key)).toEqual(RAMP)
    expect(m.subdiv.has(key)).toBe(false)
  })

  it('recolors overlapping detail bevels whole and keeps holes empty', () => {
    const m = modelWithCube()
    writeBox(m, at, [1, null, null], { slot: A, chamfer: RAMP })
    writeBox(m, at, [0, null, null], null)
    expect(recolorBox(m, at, [1, 0, null], B)).toBe(true)
    const sub = m.subdiv.get(key)!
    expect(sub.split).toEqual(['x'])
    expect(sub.children).toEqual([null, { slot: B, chamfer: RAMP }])
  })

  it('is a no-op (false) when the slot already matches', () => {
    const m = modelWithCube()
    expect(recolorBox(m, at, WHOLE_BOX, A)).toBe(false)
  })
})

describe('normalizeCell', () => {
  it('folds uniform plain children and drops all-empty entries', () => {
    const m = emptyModel()
    m.subdiv.set(key, { split: ['x', 'y'], children: [{ slot: A }, { slot: A }, { slot: A }, { slot: A }] })
    normalizeCell(m, at)
    expect(m.subdiv.has(key)).toBe(false)
    expect(m.color.get(key)).toEqual({ paletteSlot: A })
    m.subdiv.set(encodeKey(0, 0, 0), { split: ['z'], children: [null, null] })
    normalizeCell(m, [0, 0, 0])
    expect(m.subdiv.has(encodeKey(0, 0, 0))).toBe(false)
    expect(m.color.has(encodeKey(0, 0, 0))).toBe(false)
  })

  it('never merges bevels', () => {
    const m = emptyModel()
    m.subdiv.set(key, { split: ['x'], children: [{ slot: A, chamfer: RAMP }, { slot: A, chamfer: RAMP }] })
    normalizeCell(m, at)
    expect(m.subdiv.get(key)!.split).toEqual(['x'])
  })

  it('readCellDetail sees every voxel as split + children', () => {
    const m = modelWithCube()
    m.chamfer.set(key, RAMP)
    expect(readCellDetail(m, key)).toEqual({ split: [], children: [{ slot: A, chamfer: RAMP }] })
    expect(readCellDetail(m, encodeKey(9, 9, 9))).toEqual({ split: [], children: [null] })
  })
})
