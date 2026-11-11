import { describe, expect, it } from 'vitest'
import type { DetailChild, SplitAxis } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import {
  advanceGridSplit,
  childInSlab,
  childOrigin,
  canScaffold,
  canSubdivide,
  cloneSubdiv,
  coarsenCell,
  countSubdivChildren,
  describeGridSplit,
  ensureSplitForPaint,
  eraseSubCell,
  frontSlabBit,
  isSubdivided,
  isValidSplit,
  mirrorSubdivChildren,
  octantIndex,
  octantOffset,
  paintSubCell,
  quadrantSubcells,
  rotateSubdivChildren,
  sampleDetailNeighborhood,
  scaffoldCell,
  splitChildBits,
  splitChildCount,
  splitChildIndex,
  splitChildOrigin,
  splitChildSize,
  subdivChildFootprint,
  subdivideCell,
  voxelWireframeSegments,
  writeSubCell,
} from './subdiv'
import { emptyModel, encodeKey, recomputeBounds } from './GridStore'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
const base1: PaletteSlotRef = { kind: 'base', index: 1 }

describe('octant math (8-split compatibility)', () => {
  it('octantOffset/octantIndex round-trip all 8 octants', () => {
    for (let i = 0; i < 8; i++) {
      const [dx, dy, dz] = octantOffset(i)
      expect(octantIndex(dx, dy, dz)).toBe(i)
    }
  })

  it('childOrigin lands on exact halves', () => {
    expect(childOrigin([2, -3, 0], 0)).toEqual([2, -3, 0])
    expect(childOrigin([2, -3, 0], 7)).toEqual([2.5, -2.5, 0.5])
    expect(childOrigin([2, -3, 0], 3)).toEqual([2.5, -2.5, 0])
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

  it('ensureSplitForPaint splits plain cubes, scaffolds empties, and clears bevels', () => {
    const slot = { kind: 'base', index: 0 } as PaletteSlotRef
    // Plain cube subdivides, inheriting the slot.
    const solid = emptyModel()
    solid.color.set(encodeKey(0, 0, 0), { paletteSlot: slot })
    expect(ensureSplitForPaint(solid, [0, 0, 0], ['x'], slot)).toBe(true)
    expect(solid.subdiv.get(encodeKey(0, 0, 0))?.split).toEqual(['x'])
    // Empty space scaffolds.
    const empty = emptyModel()
    expect(ensureSplitForPaint(empty, [1, 1, 1], ['x', 'y'], slot)).toBe(true)
    const scaffold = empty.subdiv.get(encodeKey(1, 1, 1))
    expect(scaffold?.scaffold).toBe(true)
    expect(scaffold?.children).toEqual([null, null, null, null])
    // Chamfered cells have their bevel cleared first, then split (detail wins).
    const beveled = emptyModel()
    beveled.color.set(encodeKey(2, 2, 2), { paletteSlot: slot })
    beveled.chamfer.set(encodeKey(2, 2, 2), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'ramp', rotation: 0 },
    })
    expect(ensureSplitForPaint(beveled, [2, 2, 2], ['z'], slot)).toBe(true)
    expect(beveled.chamfer.has(encodeKey(2, 2, 2))).toBe(false)
    expect(beveled.subdiv.get(encodeKey(2, 2, 2))?.split).toEqual(['z'])
    // Existing entries are kept as-is (never re-split or wiped).
    expect(ensureSplitForPaint(solid, [0, 0, 0], ['y'], slot)).toBe(true)
    expect(solid.subdiv.get(encodeKey(0, 0, 0))?.split).toEqual(['x'])
    // Invalid splits refuse.
    expect(ensureSplitForPaint(emptyModel(), [0, 0, 0], [] as unknown as SplitAxis[], slot)).toBe(false)
  })

  it('canSubdivide admits only plain cubes (chamfered cells auto-clear at paint time)', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(canSubdivide(model, [0, 0, 0])).toBe(true)
    model.chamfer.set(encodeKey(0, 0, 0), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'ramp', rotation: 0 },
    })
    expect(canSubdivide(model, [0, 0, 0])).toBe(false)
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
      expect(sub!.slot).toEqual(base0)
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

describe('coarsenCell', () => {
  it('restores the original slot even after children are repainted', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [0, 0, 0], ['x', 'y'])
    paintSubCell(model, [0, 0, 0], 0, base1)
    paintSubCell(model, [0, 0, 0], 3, base1)
    expect(coarsenCell(model, [0, 0, 0])).toBe(true)
    expect(isSubdivided(model, [0, 0, 0])).toBe(false)
    expect(model.color.get(encodeKey(0, 0, 0))).toEqual({ paletteSlot: base0 })
  })

  it('deletes a scaffold instead of restoring a cube that was never there', () => {
    const model = emptyModel()
    expect(scaffoldCell(model, [0, 0, 0], ['x', 'y'], base0)).toBe(true)
    paintSubCell(model, [0, 0, 0], 0, base1)
    expect(coarsenCell(model, [0, 0, 0])).toBe(true)
    expect(isSubdivided(model, [0, 0, 0])).toBe(false)
    expect(model.color.has(encodeKey(0, 0, 0))).toBe(false)
  })

  it('is a no-op on non-subdivided cells', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(coarsenCell(model, [0, 0, 0])).toBe(false)
    expect(coarsenCell(model, [9, 9, 9])).toBe(false)
  })
})

describe('scaffoldCell/canScaffold', () => {
  it('splits empty space into an all-null detail parent with the given slot', () => {
    const model = emptyModel()
    expect(scaffoldCell(model, [1, 2, 3], ['z', 'x'], base1)).toBe(true)
    const sub = model.subdiv.get(encodeKey(1, 2, 3))
    expect(sub).toBeDefined()
    expect(sub!.scaffold).toBe(true)
    expect(sub!.split).toEqual(['x', 'z'])
    expect(sub!.slot).toEqual(base1)
    expect(sub!.children).toHaveLength(4)
    expect(sub!.children.every((c) => c === null)).toBe(true)
    expect(model.color.has(encodeKey(1, 2, 3))).toBe(false)
  })

  it('refuses occupied cells and invalid splits, and never clobbers', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.chamfer.set(encodeKey(1, 0, 0), { planeAxis: 'y', planeOrientation: 1, resolvedTo: null })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    expect(scaffoldCell(model, [0, 0, 0], ['x'], base1)).toBe(false)
    expect(scaffoldCell(model, [1, 0, 0], ['x'], base1)).toBe(false)
    expect(scaffoldCell(model, [2, 0, 0], [], base1)).toBe(false)
    expect(scaffoldCell(model, [2, 0, 0], ['x', 'x'], base1)).toBe(false)
    expect(model.subdiv.size).toBe(0)
    expect(scaffoldCell(model, [3, 0, 0], ['x'], base1)).toBe(true)
    expect(scaffoldCell(model, [3, 0, 0], ['y'], base1)).toBe(false)
  })

  it('canScaffold is true only for genuinely empty cells', () => {
    const model = emptyModel()
    expect(canScaffold(model, [0, 0, 0])).toBe(true)
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    expect(canScaffold(model, [1, 0, 0])).toBe(false)
    model.chamfer.set(encodeKey(2, 0, 0), { planeAxis: 'y', planeOrientation: 1, resolvedTo: null })
    expect(canScaffold(model, [2, 0, 0])).toBe(false)
    scaffoldCell(model, [3, 0, 0], ['x'], base0)
    expect(canScaffold(model, [3, 0, 0])).toBe(false)
  })
})

describe('paintSubCell/eraseSubCell/writeSubCell', () => {
  it('paints a single child preserving chamfers, and rejects bad targets', () => {
    const model = emptyModel()
    expect(paintSubCell(model, [0, 0, 0], 0, base1)).toBe(false)
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [0, 0, 0], ['x'])
    expect(paintSubCell(model, [0, 0, 0], 2, base1)).toBe(false)
    expect(paintSubCell(model, [0, 0, 0], 1, base1)).toBe(true)
    const sub = model.subdiv.get(encodeKey(0, 0, 0))!
    expect(sub.children[1]).toEqual({ slot: base1 })
    expect(sub.children[0]).toEqual({ slot: base0 })
  })

  it('writeSubCell stores frozen chamfer shapes', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [0, 0, 0], ['x', 'y', 'z'])
    const chamfer = { planeAxis: 'y' as const, planeOrientation: 1 as const, resolvedTo: { shapeKind: 'ramp' as const, rotation: 0 as const } }
    expect(writeSubCell(model, [0, 0, 0], 3, { slot: base1, chamfer })).toBe(true)
    expect(model.subdiv.get(encodeKey(0, 0, 0))!.children[3]).toEqual({ slot: base1, chamfer })
    // Recoloring preserves the chamfer.
    expect(paintSubCell(model, [0, 0, 0], 3, base0)).toBe(true)
    expect(model.subdiv.get(encodeKey(0, 0, 0))!.children[3]).toEqual({ slot: base0, chamfer })
    expect(writeSubCell(model, [0, 0, 0], 9, { slot: base1 })).toBe(false)
  })

  it('erases content only — the entry survives until explicitly cleared', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [0, 0, 0], ['z'])
    expect(eraseSubCell(model, [0, 0, 0], 5)).toBe(false)
    expect(eraseSubCell(model, [0, 0, 0], 0)).toBe(true)
    expect(isSubdivided(model, [0, 0, 0])).toBe(true)
    expect(eraseSubCell(model, [0, 0, 0], 1)).toBe(true)
    // All-null, but the subdivision stays (repaintable scaffold); nothing restored.
    expect(isSubdivided(model, [0, 0, 0])).toBe(true)
    expect(model.color.has(encodeKey(0, 0, 0))).toBe(false)
    // Erasing an already-null child is a no-op.
    expect(eraseSubCell(model, [0, 0, 0], 0)).toBe(false)
    expect(isSubdivided(model, [0, 0, 0])).toBe(true)
  })

  it('counts live children', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [0, 0, 0], ['x', 'y', 'z'])
    subdivideCell(model, [1, 0, 0], ['y'])
    eraseSubCell(model, [0, 0, 0], 0)
    expect(countSubdivChildren(model)).toBe(7 + 2)
  })
})

describe('bounds with subdivisions', () => {
  it('subdiv parents count toward bounds; only entry deletion shrinks them', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.color.set(encodeKey(5, 0, 0), { paletteSlot: base0 })
    subdivideCell(model, [5, 0, 0], ['x'])
    model.bounds = recomputeBounds(model)
    expect(model.bounds).toEqual({ min: [0, 0, 0], max: [5, 0, 0] })
    // Content-only erase keeps the structure (and its bounds footprint).
    eraseSubCell(model, [5, 0, 0], 0)
    eraseSubCell(model, [5, 0, 0], 1)
    model.bounds = recomputeBounds(model)
    expect(model.bounds).toEqual({ min: [0, 0, 0], max: [5, 0, 0] })
    // Clearing the (already-empty) entry shrinks back.
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
    writeSubCell(model, [0, 0, 0], 1, {
      slot: base1,
      chamfer: { planeAxis: 'y', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 2 } },
    })
    const sub = model.subdiv.get(encodeKey(0, 0, 0))!
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

describe('subdivChildFootprint', () => {
  it('every quadrant set shares one footprint containing the hovered quadrant', () => {
    // The invariant the 2D hover outline relies on: all children a quadrant addresses
    // differ only on depth/unsplit axes, so they share one display footprint — and the
    // hovered quadrant's center is inside it.
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const split of [['x'], ['y'], ['z'], ['x', 'y'], ['x', 'z'], ['y', 'z'], ['x', 'y', 'z']] as SplitAxis[][]) {
        for (const qu of [0, 1]) {
          for (const qv of [0, 1]) {
            const tag = `${axis} [${split}] (${qu},${qv})`
            const set = quadrantSubcells(axis, 1, split, qu, qv)
            expect(set.length, tag).toBeGreaterThan(0)
            const feet = set.map((i) => subdivChildFootprint(axis, split, i))
            for (const f of feet) expect(f, tag).toEqual(feet[0])
            const [u0, v0, u1, v1] = feet[0]
            expect(qu * 0.5 + 0.25, `${tag} u`).toBeGreaterThanOrEqual(u0)
            expect(qu * 0.5 + 0.25, `${tag} u`).toBeLessThan(u1)
            expect(qv * 0.5 + 0.25, `${tag} v`).toBeGreaterThanOrEqual(v0)
            expect(qv * 0.5 + 0.25, `${tag} v`).toBeLessThan(v1)
          }
        }
      }
    }
  })

  it('halves for single-axis splits, full cell for depth-only, quarters below', () => {
    // z-plane (u=x, v=y): an x-split reads as two tall halves.
    expect(subdivChildFootprint('z', ['x'], 0)).toEqual([0, 0, 0.5, 1])
    expect(subdivChildFootprint('z', ['x'], 1)).toEqual([0.5, 0, 1, 1])
    // Depth-only split on its own plane: every quadrant addresses the full face.
    expect(subdivChildFootprint('z', ['z'], 0)).toEqual([0, 0, 1, 1])
    expect(subdivChildFootprint('z', ['z'], 1)).toEqual([0, 0, 1, 1])
    // uv-split and full split: quarters.
    expect(subdivChildFootprint('z', ['x', 'y'], 2)).toEqual([0, 0, 0.5, 0.5])
    expect(subdivChildFootprint('z', ['x', 'y', 'z'], 0)).toEqual([0, 0.5, 0.5, 1])
  })
})

describe('childInSlab', () => {
  it('keeps everything in whole-voxel mode', () => {
    for (let i = 0; i < 8; i++) {
      expect(childInSlab(['x', 'y', 'z'], 'z', null, i)).toBe(true)
    }
  })
  it('keeps depth-spanning children of splits that exclude the plane axis', () => {
    // A uv-split on its own plane: every child spans the full depth.
    for (let i = 0; i < 4; i++) {
      expect(childInSlab(['x', 'y'], 'z', 0, i)).toBe(true)
      expect(childInSlab(['x', 'y'], 'z', 1, i)).toBe(true)
    }
  })

  it('keeps only the matching depth bit on depth splits', () => {
    // z-plane, full split: child index bit layout is x+2y+4z.
    expect(childInSlab(['x', 'y', 'z'], 'z', 0, 2)).toBe(true) // dz=0
    expect(childInSlab(['x', 'y', 'z'], 'z', 0, 6)).toBe(false) // dz=1
    expect(childInSlab(['x', 'y', 'z'], 'z', 1, 6)).toBe(true)
    expect(childInSlab(['x', 'y', 'z'], 'z', 1, 2)).toBe(false)
    // Single-axis depth split: the bit is the whole ballgame.
    expect(childInSlab(['z'], 'z', 0, 0)).toBe(true)
    expect(childInSlab(['z'], 'z', 1, 0)).toBe(false)
    expect(childInSlab(['z'], 'z', 1, 1)).toBe(true)
  })

  it('judges against the plane axis, not the split order', () => {
    // x-plane, xz-split: children with dx=0 belong to slab 0 whatever the split order.
    expect(childInSlab(['x', 'z'], 'x', 0, 0)).toBe(true) // dx=0,dz=0
    expect(childInSlab(['x', 'z'], 'x', 0, 2)).toBe(true) // dx=0,dz=1
    expect(childInSlab(['x', 'z'], 'x', 0, 1)).toBe(false) // dx=1,dz=0
    expect(childInSlab(['x', 'z'], 'x', 1, 3)).toBe(true) // dx=1,dz=1
  })
})

describe('frontSlabBit', () => {
  it('is the viewer-side depth bit', () => {
    expect(frontSlabBit(1)).toBe(1)
    expect(frontSlabBit(-1)).toBe(0)
  })
})

describe('voxelWireframeSegments', () => {
  it('yields the 12 box edges with no split', () => {
    const segs = voxelWireframeSegments([2, 3, 4], null)
    expect(segs).toHaveLength(12)
    // Every segment spans exactly one unit along exactly one axis, within the cell.
    for (const [a, b] of segs) {
      const d = [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])].sort()
      expect(d).toEqual([0, 0, 1])
      for (const p of [a, b]) {
        expect(p[0]).toBeGreaterThanOrEqual(2)
        expect(p[0]).toBeLessThanOrEqual(3)
        expect(p[1]).toBeGreaterThanOrEqual(3)
        expect(p[1]).toBeLessThanOrEqual(4)
        expect(p[2]).toBeGreaterThanOrEqual(4)
        expect(p[2]).toBeLessThanOrEqual(5)
      }
    }
    // 8 distinct corners, each touched by 3 edges.
    const key = (p: readonly number[]): string => p.join(',')
    const counts = new Map<string, number>()
    for (const [a, b] of segs) {
      for (const p of [a, b]) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
    }
    expect(counts.size).toBe(8)
    for (const n of counts.values()) expect(n).toBe(3)
  })

  it('adds one mid-plane square per split axis', () => {
    const segs = voxelWireframeSegments([0, 0, 0], ['x'])
    expect(segs).toHaveLength(16)
    const mid = segs.slice(12)
    // All four mid segments sit on the x=0.5 plane and form a unit square.
    for (const [a, b] of mid) {
      expect(a[0]).toBe(0.5)
      expect(b[0]).toBe(0.5)
    }
    expect(mid).toContainEqual([[0.5, 0, 0], [0.5, 1, 0]])
    expect(mid).toContainEqual([[0.5, 1, 0], [0.5, 1, 1]])
    expect(mid).toContainEqual([[0.5, 1, 1], [0.5, 0, 1]])
    expect(mid).toContainEqual([[0.5, 0, 1], [0.5, 0, 0]])
    // Full split: box + three squares.
    expect(voxelWireframeSegments([0, 0, 0], ['x', 'y', 'z'])).toHaveLength(24)
  })
})

describe('sampleDetailNeighborhood', () => {
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
    expect(sampleDetailNeighborhood(model, PLANE, [5, 5, 0], 5)).toEqual({
      N: true, S: false, E: true, W: true, NE: true, NW: true, SE: false, SW: false,
    })
  })

  it('reads live children in adjacent subdivided parents (no color cell needed)', () => {
    const model = emptyModel()
    expect(scaffoldCell(model, [0, 0, 0], ['x', 'y', 'z'], base0)).toBe(true)
    expect(scaffoldCell(model, [1, 0, 0], ['x', 'y', 'z'], base0)).toBe(true)
    // Only the neighbor's x-lo/depth-lo child lives.
    expect(paintSubCell(model, [1, 0, 0], 0, base1)).toBe(true)
    // Child 1 (x-hi) of (0,0,0): its E probe lands in the neighbor's child 0.
    expect(sampleDetailNeighborhood(model, PLANE, [0, 0, 0], 1).E).toBe(true)
    // Everything else reads empty (siblings erased, surroundings empty).
    const { E: _e, ...rest } = sampleDetailNeighborhood(model, PLANE, [0, 0, 0], 1)
    expect(Object.values(rest).every((v) => v === false)).toBe(true)
  })

  it('separates depth slabs: front and back children see their own layer', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(subdivideCell(model, [0, 0, 0], ['x', 'y', 'z'])).toBe(true)
    // Erase the whole front slab (dz=1: children 4-7); back stays live.
    for (const o of [4, 5, 6, 7]) expect(eraseSubCell(model, [0, 0, 0], o)).toBe(true)
    // Front child 6: its S probe lands in erased front child 4.
    expect(sampleDetailNeighborhood(model, PLANE, [0, 0, 0], 6).S).toBe(false)
    // Back child 2: its S probe lands in live back child 0.
    expect(sampleDetailNeighborhood(model, PLANE, [0, 0, 0], 2).S).toBe(true)
  })

  it('reads both halves of a wide edge on spanning children', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(subdivideCell(model, [0, 0, 0], ['x'])).toBe(true)
    // u-split child 0 spans the full height: its E edge reads sibling child 1
    // through both halves (OR), everything else is empty space.
    expect(sampleDetailNeighborhood(model, PLANE, [0, 0, 0], 0)).toEqual({
      N: false, S: false, E: true, W: false, NE: false, NW: false, SE: false, SW: false,
    })
  })

  it('returns all-false for erased scaffolds', () => {
    const model = emptyModel()
    expect(scaffoldCell(model, [3, 3, 0], ['x', 'y'], base0)).toBe(true)
    const empty = { N: false, S: false, E: false, W: false, NE: false, NW: false, SE: false, SW: false }
    for (let i = 0; i < 4; i++) {
      expect(sampleDetailNeighborhood(model, PLANE, [3, 3, 0], i)).toEqual(empty)
    }
  })
})
