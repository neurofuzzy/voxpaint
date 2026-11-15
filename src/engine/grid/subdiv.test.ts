import { describe, expect, it } from 'vitest'
import type { DetailChild, SplitAxis } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import {
  advanceGridSplit,
  cloneSubdiv,
  countSubdivChildren,
  describeGridSplit,
  gridFamilyOf,
  isSubdivided,
  isValidSplit,
  mirrorSubdivChildren,
  octantOffset,
  quadrantSubcells,
  rotateSubdivChildren,
  sampleBoxNeighborhood,
  splitChildBits,
  splitChildCount,
  splitChildIndex,
  splitChildOrigin,
  splitChildSize,
  subdivideCell,
  visibleChildAt,
} from './subdiv'
import { childBox, frontSlabBit } from './cellBox'
import { emptyModel, encodeKey, recomputeBounds } from './GridStore'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
const base1: PaletteSlotRef = { kind: 'base', index: 1 }

/** Neighborhood of one existing child (the box it occupies). */
function sampleChild(model: ReturnType<typeof emptyModel>, plane: ConstructionPlane, parent: [number, number, number], index: number) {
  return sampleBoxNeighborhood(model, plane, parent, childBox(model.subdiv.get(encodeKey(...parent))!.split, index))
}

/** An all-empty subdivision (only reachable by hand — writes normalize these away). */
function emptySplit(model: ReturnType<typeof emptyModel>, at: [number, number, number], split: SplitAxis[]) {
  model.subdiv.set(encodeKey(...at), { split, children: Array.from({ length: 2 ** split.length }, () => null) })
}

describe('octant math (8-split compatibility)', () => {
  it('octantOffset matches splitChildBits on the full split', () => {
    for (let i = 0; i < 8; i++) expect(octantOffset(i)).toEqual(splitChildBits(['x', 'y', 'z'], i))
  })

})

describe('split math', () => {
  it('isValidSplit accepts 1–3 distinct world axes', () => {
    expect(isValidSplit(['x'])).toBe(true)
    expect(isValidSplit(['x', 'z'])).toBe(true)
    expect(isValidSplit(['x', 'y', 'z'])).toBe(true)
    expect(isValidSplit([])).toBe(false)
    expect(isValidSplit(['x', 'x'])).toBe(false)
    expect(isValidSplit(['x', 'y', 'z', 'x'])).toBe(false)
    expect(isValidSplit(['w' as SplitAxis])).toBe(false)
  })

  it('splitChildCount is 2^split', () => {
    expect(splitChildCount(['y'])).toBe(2)
    expect(splitChildCount(['x', 'z'])).toBe(4)
    expect(splitChildCount(['x', 'y', 'z'])).toBe(8)
  })

  it('splitChildIndex/splitChildBits round-trip every child of every split', () => {
    const splits: SplitAxis[][] = [['x'], ['y'], ['z'], ['x', 'y'], ['x', 'z'], ['y', 'z'], ['x', 'y', 'z']]
    for (const split of splits) {
      for (let i = 0; i < 2 ** split.length; i++) {
        const [dx, dy, dz] = splitChildBits(split, i)
        expect(splitChildIndex(split, dx, dy, dz), `${split} ${i}`).toBe(i)
      }
    }
  })

  it('splitChildSize is 0.5 on split axes, 1 elsewhere', () => {
    expect(splitChildSize(['y'])).toEqual([1, 0.5, 1])
    expect(splitChildSize(['x', 'z'])).toEqual([0.5, 1, 0.5])
  })

  it('splitChildOrigin lands children exactly within the parent', () => {
    // u-split: children tile [0,0.5] and [0.5,1] in x.
    expect(splitChildOrigin([0, 0, 0], ['x'], 0)).toEqual([0, 0, 0])
    expect(splitChildOrigin([0, 0, 0], ['x'], 1)).toEqual([0.5, 0, 0])
    // uv-split: quadrant (1,0) in x,z at y=0.
    expect(splitChildOrigin([1, 2, 3], ['x', 'z'], 1)).toEqual([1.5, 2, 3])
  })

  it('advanceGridSplit cycles halves X → Y → Z with wraparound', () => {
    expect(advanceGridSplit('half', ['x'])).toEqual(['y'])
    expect(advanceGridSplit('half', ['y'])).toEqual(['z'])
    // Wraps within the family (never merges — the whole button owns merging).
    expect(advanceGridSplit('half', ['z'])).toEqual(['x'])
    // Unknown divisions restart the family.
    expect(advanceGridSplit('half', null)).toEqual(['x'])
    expect(advanceGridSplit('half', ['x', 'y'])).toEqual(['x'])
  })

  it('advanceGridSplit cycles quarters leave-X → leave-Y → leave-Z with wraparound', () => {
    expect(advanceGridSplit('quarter', ['y', 'z'])).toEqual(['x', 'z'])
    expect(advanceGridSplit('quarter', ['x', 'z'])).toEqual(['x', 'y'])
    expect(advanceGridSplit('quarter', ['x', 'y'])).toEqual(['y', 'z'])
    expect(advanceGridSplit('quarter', null)).toEqual(['y', 'z'])
  })

  it('advanceGridSplit holds octal on full', () => {
    expect(advanceGridSplit('octal', ['x', 'y', 'z'])).toEqual(['x', 'y', 'z'])
    expect(advanceGridSplit('octal', null)).toEqual(['x', 'y', 'z'])
  })

  it('describeGridSplit labels divisions in world terms', () => {
    expect(describeGridSplit(null)).toBe('whole voxels')
    expect(describeGridSplit(['x'])).toBe('halves along X')
    expect(describeGridSplit(['y', 'z'])).toBe('quarters in YZ (X stays whole)')
    expect(describeGridSplit(['x', 'y', 'z'])).toBe('full 2×2×2')
  })

})

describe('read helpers', () => {
  it('gridFamilyOf derives the picker family from the split', () => {
    expect(gridFamilyOf(null)).toBe('whole')
    expect(gridFamilyOf(['y'])).toBe('half')
    expect(gridFamilyOf(['x', 'z'])).toBe('quarter')
    expect(gridFamilyOf(['x', 'y', 'z'])).toBe('octal')
  })

  it('counts live children and reports subdivided parents', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [0, 0, 0], ['x', 'y', 'z'])
    model.subdiv.get(encodeKey(0, 0, 0))!.children[3] = null
    expect(countSubdivChildren(model)).toBe(7)
    expect(isSubdivided(model, [0, 0, 0])).toBe(true)
    expect(isSubdivided(model, [1, 0, 0])).toBe(false)
  })

  it('visibleChildAt shows the viewer-side live child, or only the plane slab on a half stop', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [0, 0, 0], ['z'])
    const sub = model.subdiv.get(encodeKey(0, 0, 0))!
    const whole: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0, half: null }
    // Orientation +1 views from +z: the high-z child (index 1) is in front.
    expect(visibleChildAt(whole, sub, 0, 0)).toBe(1)
    sub.children[1] = null
    expect(visibleChildAt(whole, sub, 0, 0)).toBe(0)
    // A half stop is a cutaway: only its own slab shows, empty or not.
    expect(visibleChildAt({ ...whole, half: 1 }, sub, 0, 0)).toBeNull()
    expect(visibleChildAt({ ...whole, half: 0 }, sub, 0, 0)).toBe(0)
  })
})

describe('subdivideCell', () => {
  it('replaces a plain cube with inheriting children for every split shape', () => {
    for (const split of [['x'], ['z'], ['x', 'y'], ['x', 'y', 'z']] as SplitAxis[][]) {
      const model = emptyModel()
      model.color.set(encodeKey(1, 2, 3), { paletteSlot: base0 })
      expect(subdivideCell(model, [1, 2, 3], split)).toBe(true)
      expect(model.color.has(encodeKey(1, 2, 3))).toBe(false)
      const sub = model.subdiv.get(encodeKey(1, 2, 3))
      expect(sub).toBeDefined()
      expect(sub!.split).toEqual([...split].sort())
      expect(sub!.children).toHaveLength(2 ** split.length)
      // Distinct objects (no aliasing), inheriting the slot.
      const [first, ...rest] = sub!.children
      expect(first).toEqual({ slot: base0 })
      for (const c of rest) {
        expect(c).toEqual({ slot: base0 })
        expect(c).not.toBe(first)
      }
    }
  })

  it('normalizes split order and defaults to a full 8-way split', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(subdivideCell(model, [0, 0, 0], ['z', 'x'])).toBe(true)
    expect(model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['x', 'z'])
    const model2 = emptyModel()
    model2.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(subdivideCell(model2, [0, 0, 0])).toBe(true)
    expect(model2.subdiv.get(encodeKey(0, 0, 0))!.children).toHaveLength(8)
  })

  it('refuses empty, chamfered, already-subdivided cells and invalid splits', () => {
    const model = emptyModel()
    expect(subdivideCell(model, [0, 0, 0], ['x'])).toBe(false)
    expect(subdivideCell(model, [0, 0, 0], [])).toBe(false)
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.chamfer.set(encodeKey(0, 0, 0), { planeAxis: 'y', planeOrientation: 1, resolvedTo: null })
    expect(subdivideCell(model, [0, 0, 0], ['x'])).toBe(false)
    model.chamfer.delete(encodeKey(0, 0, 0))
    expect(subdivideCell(model, [0, 0, 0], ['x'])).toBe(true)
    expect(subdivideCell(model, [0, 0, 0], ['y'])).toBe(false)
    expect(model.subdiv.size).toBe(1)
  })
})

describe('bounds with subdivisions', () => {
  it('subdiv parents count toward bounds; deleting the entry shrinks them', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.color.set(encodeKey(5, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [5, 0, 0], ['x'])
    model.bounds = recomputeBounds(model)
    expect(model.bounds).toEqual({ min: [0, 0, 0], max: [5, 0, 0] })
    // Deleting the entry shrinks back.
    model.subdiv.delete(encodeKey(5, 0, 0))
    model.bounds = recomputeBounds(model)
    expect(model.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
  })
})

describe('clone + rotate/mirror with splits', () => {
  it('cloneSubdiv deep-copies the entry including chamfers', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [0, 0, 0], ['x', 'y'])
    const sub = model.subdiv.get(encodeKey(0, 0, 0))!
    sub.children[1] = {
      slot: base1,
      chamfer: { planeAxis: 'y', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 2 } },
    }
    const clone = cloneSubdiv(sub)
    expect(clone).toEqual(sub)
    expect(clone).not.toBe(sub)
    expect(clone.split).not.toBe(sub.split)
    expect(clone.children).not.toBe(sub.children)
    expect(clone.children[1]).toEqual(sub.children[1])
    expect(clone.children[1]).not.toBe(sub.children[1])
    clone.children[1] = null
    expect(sub.children[1]).not.toBeNull()
  })

  it('rotation composes: cw+ccw, 4x cw, and mirror twice are identity, on every plane', () => {
    const distinct: (DetailChild | null)[] = Array.from({ length: 8 }, (_, i) => ({ slot: { kind: 'base', index: i } }))
    for (const axis of ['x', 'y', 'z'] as const) {
      const split: SplitAxis[] = ['x', 'y', 'z']
      const cw = rotateSubdivChildren(distinct, split, axis, 'cw')
      expect(cw.split).toEqual(split)
      expect(rotateSubdivChildren(cw.children, cw.split, axis, 'ccw').children).toEqual(distinct)
      let four = [...distinct]
      let fourSplit = split
      for (let i = 0; i < 4; i++) {
        const r = rotateSubdivChildren(four, fourSplit, axis, 'cw')
        four = r.children
        fourSplit = r.split
      }
      expect(four).toEqual(distinct)
      expect(fourSplit).toEqual(split)
      expect(mirrorSubdivChildren(mirrorSubdivChildren(distinct, split, axis, true, false), split, axis, true, false)).toEqual(distinct)
      expect(mirrorSubdivChildren(mirrorSubdivChildren(distinct, split, axis, false, true), split, axis, false, true)).toEqual(distinct)
    }
  })

  it('rotation preserves every child (a permutation, never a drop or dup)', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const distinct: (DetailChild | null)[] = Array.from({ length: 8 }, (_, i) => ({ slot: { kind: 'base', index: i } }))
      const sorted = [...rotateSubdivChildren(distinct, ['x', 'y', 'z'], axis, 'cw').children].sort(
        (a, b) => a!.slot.index - b!.slot.index,
      )
      expect(sorted).toEqual(distinct)
    }
  })

  it('leaves erased holes in place through the permutation', () => {
    const distinct: (DetailChild | null)[] = Array.from({ length: 8 }, (_, i) => ({ slot: { kind: 'base', index: i } }))
    const holed = [null, ...distinct.slice(1)]
    for (const axis of ['x', 'y', 'z'] as const) {
      const split: SplitAxis[] = ['x', 'y', 'z']
      const out = rotateSubdivChildren(holed, split, axis, 'cw')
      expect(out.children.filter((c) => c === null)).toHaveLength(1)
      // Rotating back restores the hole exactly.
      expect(rotateSubdivChildren(out.children, out.split, axis, 'ccw').children).toEqual(holed)
    }
  })

  it('permutes partial splits: a quarter turn exchanges the split axes', () => {
    const pair: (DetailChild | null)[] = [{ slot: { kind: 'base', index: 0 } }, { slot: { kind: 'base', index: 1 } }]
    // A single quarter turn about the plane normal exchanges the in-plane split axes (a
    // u-split turned on its side is a v-split); two make 180° and swap the halves back in
    // the original split.
    const once = rotateSubdivChildren(pair, ['x'], 'z', 'cw')
    expect(once.split).toEqual(['y'])
    const twice = rotateSubdivChildren(once.children, once.split, 'z', 'cw')
    expect(twice.split).toEqual(['x'])
    expect(twice.children).toEqual([pair[1], pair[0]])
    // Mirroring preserves axes: across the split axis swaps; along it is identity.
    expect(mirrorSubdivChildren(pair, ['x'], 'z', true, false)).toEqual([pair[1], pair[0]])
    expect(mirrorSubdivChildren(pair, ['x'], 'z', false, true)).toEqual(pair)
    // A 4-way uv-split rotates quadrants: cw maps (0,1,2,3) in x+2y order correctly.
    const quad: (DetailChild | null)[] = [0, 1, 2, 3].map((index) => ({ slot: { kind: 'base', index } }))
    const cw = rotateSubdivChildren(quad, ['x', 'y'], 'z', 'cw')
    expect(cw.split).toEqual(['x', 'y'])
    expect(cw.children.map((c) => c!.slot.index)).toEqual([1, 3, 0, 2])
  })
})

describe('quadrantSubcells', () => {
  it('matches quadrants on split in-plane axes only, front-first, covering every child', () => {
    // Independent characterization (not re-implementing the helper): a child belongs to a
    // quadrant iff its logical bits agree on every SPLIT in-plane axis; unsplit axes match
    // everything. Front (viewer-side depth bit) sorts first within each set.
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const orientation of [1, -1] as const) {
        for (const split of [['x', 'y', 'z'], ['x', 'y'], ['x'], ['z'], ['y']] as SplitAxis[][]) {
          const seen = new Set<number>()
          for (const qu of [0, 1]) {
            for (const qv of [0, 1]) {
              const set = quadrantSubcells(axis, orientation, split, qu, qv)
              expect(set.length, `${axis}${orientation} ${split} (${qu},${qv})`).toBeGreaterThan(0)
              // Expected set, derived from the plane basis directly in the test.
              const { uDir, vDir } = planeLogicalBasis(axis)
              const uAxis: SplitAxis = uDir[0] !== 0 ? 'x' : uDir[1] !== 0 ? 'y' : 'z'
              const vAxis: SplitAxis = vDir[0] !== 0 ? 'x' : vDir[1] !== 0 ? 'y' : 'z'
              const wAxis = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
              const wBitOf = (i: number): number => splitChildBits(split, i)[wAxis]
              const expected = Array.from({ length: 2 ** split.length }, (_, i) => i).filter((i) => {
                const [dx, dy, dz] = splitChildBits(split, i)
                const bits = { x: dx, y: dy, z: dz }
                const bu = uDir[axisIndex(uAxis)] > 0 ? bits[uAxis] : 1 - bits[uAxis]
                const bv = vDir[axisIndex(vAxis)] > 0 ? bits[vAxis] : 1 - bits[vAxis]
                return (!split.includes(uAxis) || bu === qu) && (!split.includes(vAxis) || bv === qv)
              })
              const frontFirst = [...expected].sort((a, b) => {
                const fa = wBitOf(a) === (orientation === 1 ? 1 : 0) ? 0 : 1
                const fb = wBitOf(b) === (orientation === 1 ? 1 : 0) ? 0 : 1
                return fa - fb
              })
              expect(set, `${axis}${orientation} ${split} (${qu},${qv})`).toEqual(frontFirst)
              for (const i of set) seen.add(i)
            }
          }
          expect([...seen].sort((a, b) => a - b)).toEqual(
            Array.from({ length: 2 ** split.length }, (_, i) => i),
          )
        }
      }
    }
  })

  it('matches the old octant mapping on full splits', () => {
    // z-plane, orientation 1: quadrant (0,0) is the (x-lo, y-hi) quarter → front octant 6,
    // back octant 2 in x+2y+4z order; quadrant (1,1) is (x-hi, y-lo) → 5 (front), 1 (back).
    expect(quadrantSubcells('z', 1, ['x', 'y', 'z'], 0, 0)).toEqual([6, 2])
    expect(quadrantSubcells('z', 1, ['x', 'y', 'z'], 1, 1)).toEqual([5, 1])
    // uv-split: one child per quadrant.
    expect(quadrantSubcells('z', 1, ['x', 'y'], 0, 0)).toEqual([2])
  })
})

describe('frontSlabBit', () => {
  it('is the viewer-side depth bit', () => {
    expect(frontSlabBit(1)).toBe(1)
    expect(frontSlabBit(-1)).toBe(0)
  })
})

describe('sampleBoxNeighborhood', () => {
  const PLANE: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0, half: null }

  it('reads siblings, plain neighbors, and empty space around one child', () => {
    const model = emptyModel()
    // Parent (5,5,0): full split, every child live.
    model.color.set(encodeKey(5, 5, 0), { paletteSlot: base0 })
    expect(subdivideCell(model, [5, 5, 0], ['x', 'y', 'z'])).toBe(true)
    // Plain cube directly east.
    model.color.set(encodeKey(6, 5, 0), { paletteSlot: base0 })
    // Child 5 (x-hi, y-lo, z-hi): E looks at the plain cube, N/W/NW at live
    // siblings, everything else at empty space.
    expect(sampleChild(model, PLANE, [5, 5, 0], 5)).toEqual({
      N: true, S: false, E: true, W: true, NE: true, NW: true, SE: false, SW: false,
    })
  })

  it('reads live children in adjacent subdivided parents (no color cell needed)', () => {
    const model = emptyModel()
    emptySplit(model, [0, 0, 0], ['x', 'y', 'z'])
    emptySplit(model, [1, 0, 0], ['x', 'y', 'z'])
    // Only the neighbor's x-lo/depth-lo child lives.
    model.subdiv.get(encodeKey(1, 0, 0))!.children[0] = { slot: base1 }
    // Child 1 (x-hi) of (0,0,0): its E probe lands in the neighbor's child 0.
    expect(sampleChild(model, PLANE, [0, 0, 0], 1).E).toBe(true)
    // Everything else reads empty (siblings erased, surroundings empty).
    const { E: _e, ...rest } = sampleChild(model, PLANE, [0, 0, 0], 1)
    expect(Object.values(rest).every((v) => v === false)).toBe(true)
  })

  it('separates depth slabs: front and back children see their own layer', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(subdivideCell(model, [0, 0, 0], ['x', 'y', 'z'])).toBe(true)
    // Erase the whole front slab (dz=1: children 4-7); back stays live.
    for (const o of [4, 5, 6, 7]) model.subdiv.get(encodeKey(0, 0, 0))!.children[o] = null
    // Front child 6: its S probe lands in erased front child 4.
    expect(sampleChild(model, PLANE, [0, 0, 0], 6).S).toBe(false)
    // Back child 2: its S probe lands in live back child 0.
    expect(sampleChild(model, PLANE, [0, 0, 0], 2).S).toBe(true)
  })

  it('reads both halves of a wide edge on spanning children', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(subdivideCell(model, [0, 0, 0], ['x'])).toBe(true)
    // u-split child 0 spans the full height: its E edge reads sibling child 1
    // through both halves (OR), everything else is empty space.
    expect(sampleChild(model, PLANE, [0, 0, 0], 0)).toEqual({
      N: false, S: false, E: true, W: false, NE: false, NW: false, SE: false, SW: false,
    })
  })

  it('returns all-false around an empty subdivision', () => {
    const model = emptyModel()
    emptySplit(model, [3, 3, 0], ['x', 'y'])
    const empty = { N: false, S: false, E: false, W: false, NE: false, NW: false, SE: false, SW: false }
    for (let i = 0; i < 4; i++) {
      expect(sampleChild(model, PLANE, [3, 3, 0], i)).toEqual(empty)
    }
  })
})
