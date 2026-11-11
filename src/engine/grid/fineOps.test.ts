import { describe, expect, it } from 'vitest'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { gridCoordFromPixel, planeLogicalBasis } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { fineDivisionFor, fineRectRegion, isFineSelected, isSelectedAt, worldAxisOf } from '@/engine/tools/fineSelection'
import { copyRegionToClipboard } from '@/engine/tools/clipboard'
import { clearFineRegion, extractFineRegion, paintFineRegion } from './fineOps'
import { emptyModel, encodeKey } from './GridStore'
import { quadrantSubcells } from './subdiv'
import type { VoxelModel } from './types'

const A = { kind: 'base', index: 0 } as PaletteSlotRef
const B = { kind: 'base', index: 1 } as PaletteSlotRef

function plainAt(plane: ConstructionPlane, u: number, v: number, slot = A): { model: VoxelModel; key: string } {
  const model = emptyModel()
  const key = encodeKey(...gridCoordFromPixel(plane, u, v))
  model.color.set(key, { paletteSlot: slot })
  return { model, key }
}

const uAxisOf = (plane: ConstructionPlane) => worldAxisOf(planeLogicalBasis(plane.axis).uDir)

const PLANES: ConstructionPlane[] = [
  { axis: 'z', orientation: 1, offset: 0, half: null },
  { axis: 'y', orientation: 1, offset: 0, half: null },
  { axis: 'x', orientation: -1, offset: 0, half: null },
]

describe('fine selection regions', () => {
  it('whole division makes an ordinary rect region (no fine mask)', () => {
    const div = fineDivisionFor(PLANES[0], null)
    const r = fineRectRegion(div, 1, 2, 3, 4)
    expect(r.fine).toBeUndefined()
    expect(r).toMatchObject({ originU: 1, originV: 2, width: 3, height: 3 })
  })

  it('halves on the in-plane u axis: fine cells select half voxels; coverage is the touched cells', () => {
    const plane = PLANES[0] // z plane: u = x, v = y
    const div = fineDivisionFor(plane, ['x'])
    expect(div).toEqual({ su: 2, sv: 1, slab: null })
    const r = fineRectRegion(div, 3, 0, 4, 0) // fine u 3..4: upper half of cell 1 + lower half of cell 2
    expect(r).toMatchObject({ originU: 1, width: 2, height: 1 })
    expect([...r.mask]).toEqual([1, 1])
    expect(isFineSelected(r, 2, 0)).toBe(false)
    expect(isFineSelected(r, 3, 0)).toBe(true)
    expect(isFineSelected(r, 4, 0)).toBe(true)
    expect(isFineSelected(r, 5, 0)).toBe(false)
  })

  it('a cut on the plane axis records the slab', () => {
    expect(fineDivisionFor(PLANES[0], ['z'])).toMatchObject({ su: 1, sv: 1, slab: 1 }) // viewer side
    expect(fineDivisionFor({ ...PLANES[0], half: 0 }, ['z'])).toMatchObject({ slab: 0 })
  })

  it('paint clips to the fine cells, per quadrant', () => {
    const plane = PLANES[0]
    const r = fineRectRegion(fineDivisionFor(plane, ['x']), 3, 0, 3, 0) // upper-x half of cell 1
    expect(isSelectedAt(r, plane, 1, 0, 1, 0)).toBe(true)
    expect(isSelectedAt(r, plane, 1, 0, 0, 0)).toBe(false)
    expect(isSelectedAt(r, plane, 1, 0)).toBe(true) // no quadrant info: any selected part counts
    expect(isSelectedAt(r, plane, 2, 0, 0, 0)).toBe(false)
  })
})

describe.each(PLANES.map((p) => [`${p.axis}${p.orientation > 0 ? '+' : '-'}`, p] as const))('clearing fine cells on plane %s', (_n, plane) => {
  it('clearing half a plain voxel splits it and removes only that half', () => {
    const { model, key } = plainAt(plane, 1, 0)
    const div = fineDivisionFor(plane, [uAxisOf(plane)])
    // Select the logical-high half along u.
    const r = fineRectRegion(div, 1 * div.su + 1, 0, 1 * div.su + 1, 0)
    clearFineRegion(model, plane, r)
    const sub = model.subdiv.get(key)!
    expect(sub).toBeDefined()
    expect(model.color.has(key)).toBe(false)
    const cleared = quadrantSubcells(plane.axis, plane.orientation, sub.split, 1, 0)
    sub.children.forEach((c, i) => expect(c === null).toBe(cleared.includes(i)))
    expect(sub.children.some((c) => c !== null)).toBe(true)
  })

  it('covering the whole voxel deletes it outright', () => {
    const { model, key } = plainAt(plane, 1, 0)
    const div = fineDivisionFor(plane, [uAxisOf(plane)])
    clearFineRegion(model, plane, fineRectRegion(div, 1 * div.su, 0, 1 * div.su + 1, 0))
    expect(model.color.has(key)).toBe(false)
    expect(model.subdiv.has(key)).toBe(false)
  })

  it('clearing every half one after the other leaves nothing behind', () => {
    const { model, key } = plainAt(plane, 1, 0)
    const div = fineDivisionFor(plane, [uAxisOf(plane)])
    clearFineRegion(model, plane, fineRectRegion(div, 1 * div.su, 0, 1 * div.su, 0))
    clearFineRegion(model, plane, fineRectRegion(div, 1 * div.su + 1, 0, 1 * div.su + 1, 0))
    expect(model.subdiv.has(key)).toBe(false)
    expect(model.color.has(key)).toBe(false)
  })
})

describe('fine edits through the plane slab and re-splits', () => {
  const plane = PLANES[0]

  it('a slab selection clears only that slab (grid cutting the plane axis)', () => {
    const { model, key } = plainAt(plane, 0, 0)
    const div = fineDivisionFor(plane, ['z']) // slab 1
    clearFineRegion(model, plane, fineRectRegion(div, 0, 0, 0, 0))
    const sub = model.subdiv.get(key)!
    expect(sub.split).toEqual(['z'])
    expect(sub.children[0]).not.toBeNull() // z bit 0 survives
    expect(sub.children[1]).toBeNull() // z bit 1 (the selected slab) is gone
  })

  it('a finer cut re-splits an existing subdivision without losing detail', () => {
    const { model, key } = plainAt(plane, 0, 0)
    // First: clear the z-high slab -> split ['z'].
    clearFineRegion(model, plane, fineRectRegion(fineDivisionFor(plane, ['z']), 0, 0, 0, 0))
    // Then: clear the x-high half of the whole depth with a grid cutting x (not z).
    clearFineRegion(model, plane, fineRectRegion(fineDivisionFor(plane, ['x']), 1, 0, 1, 0))
    const sub = model.subdiv.get(key)!
    expect(sub.split).toEqual(['x', 'z'])
    // Survivor: x low, z low only.
    const live = sub.children.map((c, i) => (c ? i : -1)).filter((i) => i >= 0)
    expect(live).toHaveLength(1)
  })

  it('painting half an empty cell scaffolds it and paints just that half', () => {
    const model = emptyModel()
    const div = fineDivisionFor(plane, ['x'])
    paintFineRegion(model, plane, fineRectRegion(div, 0, 0, 0, 0), B)
    const key = encodeKey(...gridCoordFromPixel(plane, 0, 0))
    const sub = model.subdiv.get(key)!
    expect(sub.children.filter(Boolean)).toHaveLength(1)
    expect(sub.children.find(Boolean)).toEqual({ slot: B })
  })

  it('painting half a voxel recolors only that half', () => {
    const { model, key } = plainAt(plane, 0, 0, A)
    paintFineRegion(model, plane, fineRectRegion(fineDivisionFor(plane, ['x']), 1, 0, 1, 0), B)
    const sub = model.subdiv.get(key)!
    expect(sub.children.map((c) => c?.slot)).toEqual([A, B])
  })

  it('a chamfer voxel is atomic: any selected part clears all of it', () => {
    const { model, key } = plainAt(plane, 0, 0)
    model.chamfer.set(key, { planeAxis: 'z', planeOrientation: 1, resolvedTo: null })
    clearFineRegion(model, plane, fineRectRegion(fineDivisionFor(plane, ['x']), 0, 0, 0, 0))
    expect(model.color.has(key)).toBe(false)
    expect(model.chamfer.has(key)).toBe(false)
    expect(model.subdiv.has(key)).toBe(false)
  })

  it('a whole-grid region still clears whole voxels (legacy behaviour)', () => {
    const { model, key } = plainAt(plane, 0, 0)
    clearFineRegion(model, plane, fineRectRegion(fineDivisionFor(plane, null), 0, 0, 0, 0))
    expect(model.color.has(key)).toBe(false)
  })
})

describe('copying a sub-voxel selection', () => {
  const plane = PLANES[0]

  it('extracts only the selected half, leaving the source untouched', () => {
    const { model, key } = plainAt(plane, 0, 0, A)
    const r = fineRectRegion(fineDivisionFor(plane, ['x']), 1, 0, 1, 0) // x-high half
    const scratch = extractFineRegion(model, plane, r)
    expect(model.color.has(key)).toBe(true) // source unchanged
    const sub = scratch.subdiv.get(key)!
    expect(sub.children.map((c) => (c ? 1 : 0))).toEqual([0, 1])
  })

  it('the clipboard carries the partial voxel as detail', () => {
    const { model, key } = plainAt(plane, 0, 0, A)
    const r = fineRectRegion(fineDivisionFor(plane, ['x']), 1, 0, 1, 0)
    const clip = copyRegionToClipboard(model, plane, r)
    expect(clip.cells).toHaveLength(1)
    expect(clip.cells[0].subdiv?.children.map((c) => (c ? 1 : 0))).toEqual([0, 1])
    expect(clip.cells[0].color).toBeUndefined()
    expect(model.color.has(key)).toBe(true)
  })

  it('a slab selection extracts only that slab', () => {
    const { model, key } = plainAt(plane, 0, 0, A)
    const r = fineRectRegion(fineDivisionFor(plane, ['z']), 0, 0, 0, 0) // slab 1
    const sub = extractFineRegion(model, plane, r).subdiv.get(key)!
    expect(sub.split).toEqual(['z'])
    expect(sub.children.map((c) => (c ? 1 : 0))).toEqual([0, 1])
  })
})
