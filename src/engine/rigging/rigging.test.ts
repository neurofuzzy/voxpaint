import { describe, expect, it } from 'vitest'
import type { Axis, Coord, Orientation } from '@/engine/grid/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { RigBox } from './types'
import { boxSliceFootprint, moveRigBoxInList, placePivotOnPlane, rigDepthOf, rigIdForCoord, rigPivotLinks, rigPivotOf, rigSubtreeIds, snapHalf, translateRigSubtree } from './types'

const box = (id: string, parentId: string | null = null): RigBox => ({
  id,
  name: id,
  min: [0, 0, 0],
  max: [1, 1, 1],
  parentId,
  pivot: null,
})

describe('rigSubtreeIds', () => {
  it('collects the whole subtree inclusive', () => {
    const boxes = [box('a'), box('b', 'a'), box('c', 'a'), box('d', 'b')]
    expect([...rigSubtreeIds(boxes, 'a')].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect([...rigSubtreeIds(boxes, 'b')].sort()).toEqual(['b', 'd'])
    expect([...rigSubtreeIds(boxes, 'c')]).toEqual(['c'])
  })
})

describe('rigIdForCoord', () => {
  const parent: RigBox = { id: 'p', name: 'p', min: [0, 0, 0], max: [3, 3, 3], parentId: null, pivot: null }
  const child: RigBox = { id: 'c', name: 'c', min: [1, 1, 1], max: [2, 2, 2], parentId: 'p', pivot: null }

  it('prefers the deepest containing box over list order', () => {
    // Parent first in list — the nested child still wins inside its bounds.
    expect(rigIdForCoord([parent, child], [1, 1, 1])).toBe('c')
    expect(rigIdForCoord([child, parent], [1, 1, 1])).toBe('c')
    expect(rigIdForCoord([parent, child], [0, 0, 0])).toBe('p')
  })

  it('returns null outside every box', () => {
    expect(rigIdForCoord([parent, child], [9, 9, 9])).toBeNull()
    expect(rigIdForCoord([], [0, 0, 0])).toBeNull()
  })
})

describe('moveRigBoxInList', () => {
  it('nests as last child of the target', () => {
    const next = moveRigBoxInList([box('a'), box('b'), box('c')], 'c', 'a', 'child')
    expect(next?.map((b) => [b.id, b.parentId])).toEqual([
      ['a', null],
      ['c', 'a'],
      ['b', null],
    ])
  })

  it('lands beside the target subtree, never splitting it', () => {
    // b has child d; moving e after b must land after d, not between b and d.
    const boxes = [box('a'), box('b'), box('d', 'b'), box('e')]
    const next = moveRigBoxInList(boxes, 'e', 'b', 'after')
    expect(next?.map((b) => b.id)).toEqual(['a', 'b', 'd', 'e'])
    expect(next?.find((b) => b.id === 'e')?.parentId).toBeNull()
  })

  it('adopts the target parent on before/after', () => {
    const boxes = [box('a'), box('b', 'a'), box('c')]
    const next = moveRigBoxInList(boxes, 'c', 'b', 'before')
    expect(next?.map((b) => [b.id, b.parentId])).toEqual([
      ['a', null],
      ['c', 'a'],
      ['b', 'a'],
    ])
  })

  it('appends at root level for a null target', () => {
    const boxes = [box('a'), box('b', 'a')]
    const next = moveRigBoxInList(boxes, 'b', null, 'after')
    expect(next?.map((b) => [b.id, b.parentId])).toEqual([
      ['a', null],
      ['b', null],
    ])
  })

  it('rejects drops into the dragged subtree, self-drops, and unknown ids', () => {
    const boxes = [box('a'), box('b', 'a')]
    expect(moveRigBoxInList(boxes, 'a', 'b', 'child')).toBeNull()
    expect(moveRigBoxInList(boxes, 'a', 'a', 'child')).toBeNull()
    expect(moveRigBoxInList(boxes, 'zzz', 'a', 'child')).toBeNull()
    expect(moveRigBoxInList(boxes, 'a', 'zzz', 'child')).toBeNull()
  })
})

describe('rigPivotOf', () => {
  it('defaults to the bbox center', () => {
    expect(rigPivotOf(box('a'))).toEqual([0.5, 0.5, 0.5])
    const wide: RigBox = { ...box('w'), min: [0, 0, 0], max: [3, 0, 1] }
    expect(rigPivotOf(wide)).toEqual([1.5, 0, 0.5])
  })

  it('returns a copy of the pivot override', () => {
    const pivoted: RigBox = { ...box('p'), pivot: [1, 0, 0] }
    const out = rigPivotOf(pivoted)
    expect(out).toEqual([1, 0, 0])
    expect(out).not.toBe(pivoted.pivot)
  })
})

describe('rigDepthOf', () => {
  it('counts outline depth, roots at zero', () => {
    const boxes = [box('a'), box('b', 'a'), box('d', 'b'), box('c', 'a')]
    const byId = new Map(boxes.map((b) => [b.id, b]))
    expect(rigDepthOf(boxes, byId.get('a')!)).toBe(0)
    expect(rigDepthOf(boxes, byId.get('b')!)).toBe(1)
    expect(rigDepthOf(boxes, byId.get('d')!)).toBe(2)
    // Dangling parents and cycles stop counting instead of looping.
    const cyclic: RigBox[] = [
      { ...box('x'), parentId: 'y' },
      { ...box('y'), parentId: 'x' },
      { ...box('z'), parentId: 'missing' },
    ]
    const cyclicById = new Map(cyclic.map((b) => [b.id, b]))
    expect(rigDepthOf(cyclic, cyclicById.get('x')!)).toBe(1)
    expect(rigDepthOf(cyclic, cyclicById.get('z')!)).toBe(0)
  })
})

describe('boxSliceFootprint', () => {
  // Box over x∈[1,2], y∈[0,0], z∈[4,5].
  const b: RigBox = { id: 'b', name: 'b', min: [1, 0, 4], max: [2, 0, 5], parentId: null, pivot: null }

  it('returns null when the slice misses the box', () => {
    expect(boxSliceFootprint(b, { axis: 'x', orientation: 1, offset: 99 })).toBeNull()
    expect(boxSliceFootprint(b, { axis: 'y', orientation: 1, offset: 3 })).toBeNull()
    // Boundary slices intersect (inclusive bounds).
    expect(boxSliceFootprint(b, { axis: 'y', orientation: 1, offset: 0 })).not.toBeNull()
    expect(boxSliceFootprint(b, { axis: 'x', orientation: 1, offset: 1 })).not.toBeNull()
  })

  it('maps in-plane extents on unmirrored planes', () => {
    // z-plane (offset 4 hits z∈[4,5]), orientation 1: u = x, v = -y - 1.
    // x∈[1,2] → display [1,3); y=0 → display cell -1 → span [-1,0).
    expect(boxSliceFootprint(b, { axis: 'z', orientation: 1, offset: 4 })).toEqual({
      uMin: 1, uMax: 3, vMin: -1, vMax: 0,
    })
  })

  it('mirrors the range exactly on mirrored planes', () => {
    // z-plane orientation -1: display cells D(1) = -2, D(2) = -3, so the rect is [-3,-1).
    expect(boxSliceFootprint(b, { axis: 'z', orientation: -1, offset: 4 })).toEqual({
      uMin: -3, uMax: -1, vMin: -1, vMax: 0,
    })
    // x-plane (offset 1 hits x∈[1,2]), orientation 1: u = z negated
    // (D(4) = -5, D(5) = -6 → [-6,-4)); v = y as above → [-1,0).
    expect(boxSliceFootprint(b, { axis: 'x', orientation: 1, offset: 1 })).toEqual({
      uMin: -6, uMax: -4, vMin: -1, vMax: 0,
    })
  })

  it('spans exactly its cells on every plane and orientation', () => {
    // Ground truth: the footprint must cover precisely the display cells of the box's own
    // cells on the slice (per-cell formula), nothing more — on all six plane/orientations.
    const wide: RigBox = { id: 'w', name: 'w', min: [-2, -1, 3], max: [0, 2, 4], parentId: null, pivot: null }
    const axes: Axis[] = ['x', 'y', 'z']
    const orientations: Orientation[] = [1, -1]
    for (const axis of axes) {
      for (const orientation of orientations) {
        const plane: ConstructionPlane = { axis, orientation, offset: wide.min[axisIndex(axis)] }
        const cells: Coord[] = []
        for (let x = wide.min[0]; x <= wide.max[0]; x++) {
          for (let y = wide.min[1]; y <= wide.max[1]; y++) {
            for (let z = wide.min[2]; z <= wide.max[2]; z++) {
              if ([x, y, z][axisIndex(axis)] === plane.offset) cells.push([x, y, z])
            }
          }
        }
        expect(cells.length).toBeGreaterThan(0)
        const du = cells.map((c) => toDisplayU(plane, pixelFromGridCoord(plane, c).u))
        const dv = cells.map((c) => toDisplayV(plane, pixelFromGridCoord(plane, c).v))
        expect(boxSliceFootprint(wide, plane)).toEqual({
          uMin: Math.min(...du),
          uMax: Math.max(...du) + 1,
          vMin: Math.min(...dv),
          vMax: Math.max(...dv) + 1,
        })
      }
    }
  })
})

describe('translateRigSubtree', () => {
  it('moves the box and its descendants, pivots riding along', () => {
    const boxes: RigBox[] = [
      { ...box('a'), min: [0, 0, 0], max: [1, 1, 1], pivot: [0, 0, 0] },
      { ...box('b', 'a'), min: [0, 0, 0], max: [0, 0, 0] },
      { ...box('c'), min: [5, 5, 5], max: [5, 5, 5] },
    ]
    const next = translateRigSubtree(boxes, 'a', [1, 0, -1], 16)!
    expect(next.find((b) => b.id === 'a')?.min).toEqual([1, 0, -1])
    expect(next.find((b) => b.id === 'a')?.max).toEqual([2, 1, 0])
    expect(next.find((b) => b.id === 'a')?.pivot).toEqual([1, 0, -1])
    expect(next.find((b) => b.id === 'b')?.min).toEqual([1, 0, -1])
    // The uninvolved box stays put (same reference).
    expect(next.find((b) => b.id === 'c')).toBe(boxes[2])
  })

  it('clamps the shift so every moved box stays in bounds', () => {
    const boxes: RigBox[] = [{ ...box('a'), min: [5, 0, 0], max: [6, 0, 0] }]
    // +5 requested, only +1 fits before max hits the working-cube edge (hi = 7).
    const next = translateRigSubtree(boxes, 'a', [5, 0, 0], 16)!
    expect(next[0].min).toEqual([6, 0, 0])
    expect(next[0].max).toEqual([7, 0, 0])
  })

  it('no-ops on unknown ids and zero-effective shifts', () => {
    const boxes: RigBox[] = [box('a')]
    expect(translateRigSubtree(boxes, 'zzz', [1, 0, 0], 16)).toBeNull()
    expect(translateRigSubtree(boxes, 'a', [0, 0, 0], 16)).toBeNull()
  })
})

describe('snapHalf', () => {
  it('rounds to the half-step lattice', () => {
    expect(snapHalf(1.2)).toBe(1)
    expect(snapHalf(1.3)).toBe(1.5)
    expect(snapHalf(-1.2)).toBe(-1)
    expect(snapHalf(2.5)).toBe(2.5)
  })

  it('normalizes -0', () => {
    expect(Object.is(snapHalf(-0.1), 0)).toBe(true)
  })
})

describe('placePivotOnPlane', () => {
  // Box over [0,2] on every axis → default (unset) pivot is its center [1,1,1].
  const b: RigBox = { ...box('b'), min: [0, 0, 0], max: [2, 2, 2] }
  const zPlane = { axis: 'z', orientation: 1, offset: 0 } as const

  it('lands cell centers exactly under the cursor', () => {
    // Display center of logical cell (1,2) is (1.5,2.5) → grid [1,-3], depth kept at 1.
    expect(placePivotOnPlane(b, zPlane, 1.5, 2.5)).toEqual([1, -3, 1])
  })

  it('snaps boundary intersections to the half lattice', () => {
    expect(placePivotOnPlane(b, zPlane, 1.2, 2.7)).toEqual([0.5, -3, 1])
    expect(placePivotOnPlane(b, zPlane, 1.2, 2.2)).toEqual([0.5, -2.5, 1])
  })

  it('keeps an explicitly set depth (rotate the plane to place it)', () => {
    const posed = { ...b, pivot: [9, 9, 9] as Coord }
    expect(placePivotOnPlane(posed, zPlane, 1.5, 2.5)).toEqual([1, -3, 9])
  })

  it('mirrors exactly on flipped orientations', () => {
    const flipped = { axis: 'z', orientation: -1, offset: 0 } as const
    // Gridline unmirror: display 1.5 → logical -1.5 → grid x -2.
    expect(placePivotOnPlane(b, flipped, 1.5, 2.5)).toEqual([-2, -3, 1])
  })

  it('maps the other plane axes the same way', () => {
    const yPlane = { axis: 'y', orientation: -1, offset: 0 } as const
    // y-plane: x = lu-0.5, z = -lv-0.5, depth y kept at the box center 1.
    expect(placePivotOnPlane(b, yPlane, 1.5, 2.5)).toEqual([1, 1, -3])
    const xPlane = { axis: 'x', orientation: 1, offset: 0 } as const
    // x-plane: y = -lv-0.5, z = -lu-0.5, depth x kept at the box center 1.
    expect(placePivotOnPlane(b, xPlane, 1.5, 2.5)).toEqual([1, -3, -2])
  })
})

describe('rigPivotLinks', () => {
  it('links each child pivot to its parent pivot', () => {
    const boxes = [
      { ...box('a'), min: [0, 0, 0] as Coord, max: [2, 2, 2] as Coord },
      { ...box('b', 'a'), min: [0, 0, 0] as Coord, max: [0, 0, 0] as Coord, pivot: [0, 0, 2] as Coord },
    ]
    // a defaults to its box center [1,1,1]; b has an explicit pivot.
    expect(rigPivotLinks(boxes)).toEqual([{ childId: 'b', from: [1, 1, 1], to: [0, 0, 2] }])
  })

  it('skips roots, dangling parents, and self-parents', () => {
    const boxes = [
      box('root'),
      { ...box('dangling', 'missing') },
      { ...box('self', 'self') },
    ]
    expect(rigPivotLinks(boxes)).toEqual([])
  })
})
