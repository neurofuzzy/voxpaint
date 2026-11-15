import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { SplitAxis } from '@/engine/grid/types'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { buildFloatGhostBatches, placedFloatCoords } from '@/engine/instancing/ghostBatches'
import { fineDivisionFor, fineRectRegion } from '@/engine/tools/fineSelection'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { useAppStore } from './useAppStore'

/**
 * Copy/paste follows the construction plane exactly, half voxels included: content keeps its
 * depth relative to the plane's stop (low edge — a whole stop and its low half share one), so
 * stepping the plane by any number of half voxels between copy and paste moves the paste by
 * exactly that much. z/1 plane throughout: pixel (0,-1) is voxel (0,0,0) at the plane's offset.
 */

const A = { kind: 'base', index: 3 } as const
const g = () => useAppStore.getState()

/** World z-extents of every live box in a column (x=0,y=0), as [z0, z1] in grid units. */
function columnBoxes(): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const m = g().model
  for (let z = -8; z < 8; z++) {
    const key = encodeKey(0, 0, z)
    if (m.color.has(key)) out.push([z, z + 1, m.color.get(key)!.paletteSlot.index])
    const sub = m.subdiv.get(key)
    if (!sub) continue
    // Column extents only (this suite only cuts z).
    sub.children.forEach((c, i) => {
      if (!c) return
      const zBit = sub.split.includes('z') ? (i >> sub.split.indexOf('z')) & 1 : null
      if (zBit === null) out.push([z, z + 1, c.slot.index])
      else out.push([z + zBit * 0.5, z + zBit * 0.5 + 0.5, c.slot.index])
    })
  }
  // Merge adjacent same-slot boxes so a plain voxel and two stacked halves compare equal.
  out.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number, number]> = []
  for (const b of out) {
    const last = merged[merged.length - 1]
    if (last && last[1] === b[0] && last[2] === b[2]) last[1] = b[1]
    else merged.push([...b])
  }
  return merged
}

function paintAt(z: number, grid: SplitAxis[] | null, half: 0 | 1 | null = null) {
  g().setGridSplit(grid)
  g().setPlaneOffset(z)
  if (half !== null) g().setPlaneHalf(half)
  g().beginStroke()
  g().paintCell(0, -1)
  g().commitStroke()
}

function selectCell(fine: boolean) {
  const plane = g().plane
  if (fine) {
    const { u, v } = pixelFromGridCoord(plane, [0, 0, plane.offset])
    g().setSelection(fineRectRegion(fineDivisionFor(plane, g().gridSplit), u, v, u, v))
  } else {
    g().setSelection({ originU: 0, originV: -1, width: 1, height: 1, mask: new Uint8Array([1]) })
  }
}

function planeTo(offset: number, half: 0 | 1 | null) {
  g().setPlaneOffset(offset)
  if (half !== null) g().setPlaneHalf(half)
  expect(g().plane).toMatchObject({ offset, half })
}

function pasteHere() {
  g().setSelection(null)
  g().pasteClipboardInPlace()
}

beforeEach(() => {
  g().newProject('Paste', 16)
  g().setPlaneAxisOrientation('z', 1)
  g().setPlaneOffset(0)
  g().setActiveVoxelKind('cube')
  g().setActivePaletteSlot(A)
})

describe('2D paste follows the plane stop', () => {
  it('a half-voxel copy pastes onto the other half of the same layer', () => {
    paintAt(0, ['z'], 1) // [0.5, 1)
    selectCell(true)
    g().copySelection()
    planeTo(0, 0)
    pasteHere()
    g().bakeFloatIfAny()
    // Source stays, the copy fills [0, 0.5): together one whole voxel.
    expect(columnBoxes()).toEqual([[0, 1, 3]])
  })

  it('a half-voxel copy follows whole-layer and half-layer plane moves exactly', () => {
    paintAt(0, ['z'], 1) // [0.5, 1)
    selectCell(true)
    g().copySelection()
    planeTo(2, 0) // 1.5 voxels down the stack from the copy's stop
    pasteHere()
    g().bakeFloatIfAny()
    expect(columnBoxes()).toEqual([[0.5, 1, 3], [2, 2.5, 3]])
  })

  it('a whole-voxel copy pastes half a voxel over when the plane sits on the high half', () => {
    paintAt(0, null) // [0, 1)
    selectCell(false)
    g().copySelection()
    g().setGridSplit(['z'])
    planeTo(2, 1)
    pasteHere()
    g().bakeFloatIfAny()
    expect(columnBoxes()).toEqual([[0, 1, 3], [2.5, 3.5, 3]])
  })

  it('a copy made on the high half pastes onto a whole stop at the layer’s low edge', () => {
    paintAt(0, ['z'], 1)
    selectCell(true)
    g().copySelection()
    g().setGridSplit(null)
    planeTo(3, null)
    pasteHere()
    g().bakeFloatIfAny()
    expect(columnBoxes()).toEqual([[0.5, 1, 3], [3, 3.5, 3]])
  })

  it('the drop replaces exactly the shifted footprint', () => {
    // Fill [2, 4) with a different color, then paste a whole voxel at [2.5, 3.5).
    g().setActivePaletteSlot({ kind: 'base', index: 5 })
    paintAt(2, null)
    paintAt(3, null)
    g().setActivePaletteSlot(A)
    paintAt(0, null)
    selectCell(false)
    g().copySelection()
    g().setGridSplit(['z'])
    planeTo(2, 1)
    pasteHere()
    g().bakeFloatIfAny()
    expect(columnBoxes()).toEqual([[0, 1, 3], [2, 2.5, 5], [2.5, 3.5, 3], [3.5, 4, 5]])
  })

  it('the 2D float preview and 3D ghost show the shifted pieces before the drop', () => {
    paintAt(0, null)
    selectCell(false)
    g().copySelection()
    g().setGridSplit(['z'])
    planeTo(2, 1)
    pasteHere()
    const st = g()
    expect(st.floatOrigin?.subW).toBe(1)
    const coords = placedFloatCoords(st.floatContent, st.floatOrigin, st.plane, st.meta.gridExtent)
    expect(coords.map((c) => c[2]).sort()).toEqual([2, 3])
    const batches = buildFloatGhostBatches(st.floatContent, st.floatOrigin, st.plane, DEFAULT_PALETTE, st.meta.gridExtent)
    expect(batches.reduce((n, b) => n + b.matrices.length, 0)).toBe(2)
  })

  it('dragging and rotating a shifted paste keep its depth shift', () => {
    paintAt(0, null)
    selectCell(false)
    g().copySelection()
    g().setGridSplit(['z'])
    planeTo(2, 1)
    pasteHere()
    g().moveFloatTo(1, -1)
    expect(g().floatOrigin).toMatchObject({ originU: 1, subW: 1 })
    g().transformFloat('rotate')
    expect(g().floatOrigin?.subW).toBe(1)
    g().bakeFloatIfAny()
    const m = g().model
    expect(m.subdiv.get(encodeKey(1, 0, 2))?.children).toEqual([null, { slot: A }])
    expect(m.subdiv.get(encodeKey(1, 0, 3))?.children).toEqual([{ slot: A }, null])
  })

  it('content holding a whole bevel stays on the voxel layer (whole bevels have no half position)', () => {
    g().setActiveVoxelKind('convex')
    paintAt(0, null)
    selectCell(false)
    g().copySelection()
    g().setGridSplit(['z'])
    planeTo(2, 1)
    pasteHere()
    expect(g().floatOrigin?.subW ?? 0).toBe(0)
    g().bakeFloatIfAny()
    expect(g().model.chamfer.get(encodeKey(0, 0, 2))?.resolvedTo?.shapeKind).toBe('convex')
  })

  it('a half-sized detail bevel survives a half-voxel shift; a full-depth one lands as a plain block', () => {
    // Half-depth bevel at [0.5, 1).
    g().setGridSplit(['z'])
    g().setActiveVoxelKind('convex')
    paintAt(0, ['z'], 1)
    selectCell(true)
    g().copySelection()
    planeTo(2, 0)
    pasteHere()
    g().bakeFloatIfAny()
    expect(g().model.subdiv.get(encodeKey(0, 0, 2))?.children[0]?.chamfer?.resolvedTo?.shapeKind).toBe('convex')
    // Full-depth bevel (x-half on the z plane) shifted half a voxel in z: cut, so plain.
    g().newProject('Paste', 16)
    g().setPlaneAxisOrientation('z', 1)
    g().setActiveVoxelKind('convex')
    g().setActivePaletteSlot(A)
    g().setGridSplit(['x'])
    g().setPlaneOffset(0)
    g().beginStroke()
    g().paintCell(0, -1, 1, 0) // x-high, full depth
    g().commitStroke()
    selectCell(false)
    g().copySelection()
    g().setGridSplit(['x', 'z'])
    planeTo(2, 1)
    pasteHere()
    g().bakeFloatIfAny()
    const m = g().model
    const lands = [encodeKey(0, 0, 2), encodeKey(0, 0, 3)].map((k) => m.subdiv.get(k))
    expect(lands.every((s) => s && s.children.some((c) => c !== null))).toBe(true)
    expect(lands.some((s) => s!.children.some((c) => c?.chamfer))).toBe(false)
  })
})

describe('3D paste follows the plane stop', () => {
  it('a coplanar 3D copy pastes half a voxel over on a high-half stop', () => {
    paintAt(0, null)
    g().setLayoutMode('3d-only')
    g().setSelectedCells(new Set([encodeKey(0, 0, 0)]))
    g().copyCells3D()
    g().clearSelectedCells()
    g().setGridSplit(['z'])
    planeTo(4, 1)
    g().pasteCells3D()
    g().bakeFloatIfAny()
    expect(columnBoxes()).toEqual([[0, 1, 3], [4.5, 5.5, 3]])
  })

  it('a targeted paste into an empty matching selection shifts the same way', () => {
    paintAt(0, null)
    g().setLayoutMode('3d-only')
    g().setSelectedCells(new Set([encodeKey(0, 0, 0)]))
    g().copyCells3D()
    g().setGridSplit(['z'])
    planeTo(4, 1)
    g().setSelectedCells(new Set([encodeKey(0, 0, 4)]))
    g().pasteCells3D()
    expect(g().floatContent).toBeNull()
    expect(columnBoxes()).toEqual([[0, 1, 3], [4.5, 5.5, 3]])
  })

  it('an exact-set (bbox) move keeps absolute depth whatever the stop', () => {
    paintAt(0, null)
    paintAt(1, null)
    g().setLayoutMode('3d-only')
    const keys = new Set([encodeKey(0, 0, 0), encodeKey(0, 0, 1)])
    g().setSelectedCells(keys)
    g().copyCells3D() // multi-depth: bbox-anchored
    expect(g().clipboard?.depthAnchor).toBe('bbox')
    g().setGridSplit(['z'])
    planeTo(0, 1)
    g().setSelectedCells(new Set())
    g().pasteCells3D()
    expect(g().floatOrigin?.subW ?? 0).toBe(0)
    g().bakeFloatIfAny()
    expect(columnBoxes()).toEqual([[0, 2, 3]])
  })
})

describe('in-plane half-voxel float offsets', () => {
  it('a whole-voxel float moved half a voxel lands as two halves, and the selection follows', () => {
    paintAt(0, null)
    selectCell(false)
    g().setGridSplit(['x'])
    g().liftSelectionToFloat()
    const o = g().floatOrigin!
    g().moveFloatTo(o.originU, o.originV, 1, 0) // +half voxel along u (+x on this plane)
    expect(g().selection?.fine).toBeDefined()
    g().bakeFloatIfAny()
    const m = g().model
    expect(m.subdiv.get(encodeKey(0, 0, 0))?.children).toEqual([null, { slot: A }])
    expect(m.subdiv.get(encodeKey(1, 0, 0))?.children).toEqual([{ slot: A }, null])
  })

  it('moving back onto the voxel grid restores a whole-cell selection', () => {
    paintAt(0, null)
    selectCell(false)
    g().setGridSplit(['x'])
    g().liftSelectionToFloat()
    const o = g().floatOrigin!
    g().moveFloatTo(o.originU, o.originV, 1, 0)
    g().moveFloatTo(o.originU + 1, o.originV, 0, 0)
    expect(g().selection?.fine).toBeUndefined()
    expect(g().selection).toMatchObject({ originU: o.originU + 1, originV: o.originV, width: 1, height: 1 })
  })

  it('whole bevels round to the nearest whole voxel, pieces and bevel staying together', () => {
    // A bevel next to a plain cube, lifted together.
    g().setActiveVoxelKind('convex')
    paintAt(0, null)
    g().setActiveVoxelKind('cube')
    g().beginStroke()
    g().paintCell(1, -1)
    g().commitStroke()
    g().setSelection({ originU: 0, originV: -1, width: 2, height: 1, mask: new Uint8Array([1, 1]) })
    g().setGridSplit(['x'])
    g().liftSelectionToFloat()
    g().moveFloatTo(0, -1, 1, 0) // half a voxel: rounds to one whole voxel over
    expect(g().floatOrigin).toMatchObject({ originU: 1, originV: -1 })
    expect(g().floatOrigin?.subU ?? 0).toBe(0)
    g().bakeFloatIfAny()
    const m = g().model
    expect(m.chamfer.get(encodeKey(1, 0, 0))?.resolvedTo?.shapeKind).toBe('convex')
    expect(m.color.has(encodeKey(2, 0, 0))).toBe(true)
    expect(m.chamfer.has(encodeKey(2, 0, 0))).toBe(false)
  })
})

