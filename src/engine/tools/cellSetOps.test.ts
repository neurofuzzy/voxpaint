import { describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Coord, VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import {
  bboxOfCoords,
  copyCellsToClipboard,
  footprintOccupiedCells,
  rotateCellsInPlane,
  snapshotCells,
} from './cellSetOps'

const PLANE: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0 }
const SLOT = { kind: 'base', index: 0 } as PaletteSlotRef

function emptyModel(): VoxelModel {
  return { color: new Map(), chamfer: new Map(), bounds: null }
}

function paintBox(model: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) model.color.set(encodeKey(x, y, z), { paletteSlot: { ...SLOT } })
}

describe('bboxOfCoords', () => {
  it('returns null when empty, min/max otherwise', () => {
    expect(bboxOfCoords([])).toBeNull()
    expect(bboxOfCoords([[1, 2, 3], [-1, 5, 0]])).toEqual({ min: [-1, 2, 0], max: [1, 5, 3] })
  })
})

describe('footprintOccupiedCells', () => {
  it('collects occupied cells in the dragged (u,v) range at any depth, nothing else', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 1, 1, 2) // 2x2 footprint, 3 deep
    paintBox(model, 5, 5, 5, 5, 5, 5) // outside
    // z-plane: u=x, v=-y-1. Drag (u 0..1, v -2..-1) == x 0..1, y 0..1.
    const from: Coord = [0, 0, 0]
    const to: Coord = [1, 1, 0]
    const found = footprintOccupiedCells(model, PLANE, from, to)
    expect(found).toHaveLength(12)
    expect(found).not.toContain(encodeKey(5, 5, 5))
  })

  it('is direction-independent and empty when nothing is under the rect', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 0, 0, 0)
    const fwd = footprintOccupiedCells(model, PLANE, [0, 0, 0], [3, 3, 0])
    const back = footprintOccupiedCells(model, PLANE, [3, 3, 0], [0, 0, 0])
    expect([...fwd].sort()).toEqual([...back].sort())
    expect(footprintOccupiedCells(model, PLANE, [4, 4, 0], [6, 6, 0])).toEqual([])
  })
})

describe('snapshotCells + copyCellsToClipboard', () => {
  it('snapshots live cells only and anchors du/dv/dw at the bbox-min', () => {
    const model = emptyModel()
    paintBox(model, 2, 3, 4, 3, 3, 5)
    model.chamfer.set(encodeKey(2, 3, 4), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'ramp', rotation: 0 },
    })
    const keys = [encodeKey(2, 3, 4), encodeKey(3, 3, 5), encodeKey(9, 9, 9)]
    const snaps = snapshotCells(model, keys)
    expect(snaps).toHaveLength(2) // stale key skipped
    const clip = copyCellsToClipboard(model, new Set(keys), PLANE)
    expect(clip.width).toBe(2)
    expect(clip.height).toBe(1)
    expect(clip.cells).toHaveLength(2)
    // bbox-min is (u2, v-4, w4): first cell sits at the origin corner.
    expect(clip.cells[0]).toMatchObject({ du: 0, dv: 0, dw: 0 })
    expect(clip.cells[1]).toMatchObject({ du: 1, dv: 0, dw: 1 })
    expect(clip.copyPlaneAxis).toBe('z')
    expect(clip.copyPlaneOffset).toBe(4)
    // Chamfer rides along deep-copied.
    expect(clip.cells[0].chamfer?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 0 })
  })

  it('empty input yields an empty clipboard', () => {
    const clip = copyCellsToClipboard(emptyModel(), new Set(), PLANE)
    expect(clip.cells).toEqual([])
  })
})

describe('rotateCellsInPlane', () => {
  function snapModel(): VoxelModel {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 1, 0, 0) // 2x1 bar on the slice
    return model
  }

  it('turns a 2x1 bar vertical (cw), preserving depth and color', () => {
    const entries = snapshotCells(snapModel(), [encodeKey(0, 0, 0), encodeKey(1, 0, 0)])
    const out = rotateCellsInPlane(entries, PLANE, 'rotate', 16)
    const coords = out.map((e) => e.coord).sort()
    // Same origin-corner-preserving math as float rotate: (0,0,0) is fixed, (1,0,0) swings down.
    expect(coords).toEqual([
      [0, -1, 0],
      [0, 0, 0],
    ])
    expect(out.every((e) => e.paletteSlot.kind === 'base')).toBe(true)
  })

  it('four cw turns restore a symmetric set with depths intact', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 1, 1, 1) // 2x2x2 cube — center-symmetric
    const coords: Coord[] = []
    for (let x = 0; x <= 1; x++) for (let y = 0; y <= 1; y++) for (let z = 0; z <= 1; z++) coords.push([x, y, z])
    const keys = coords.map((c) => encodeKey(...c))
    let entries = snapshotCells(model, keys)
    for (let i = 0; i < 4; i++) entries = rotateCellsInPlane(entries, PLANE, 'rotate', 16)
    expect(entries.map((e) => e.coord).sort()).toEqual(coords.sort())
  })

  it('renumbers chamfer rotations with the turn', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 0, 0, 0)
    model.chamfer.set(encodeKey(0, 0, 0), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'ramp', rotation: 0 },
    })
    const [only] = rotateCellsInPlane(snapshotCells(model, [encodeKey(0, 0, 0)]), PLANE, 'rotate', 16)
    expect(only.chamfer?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 1 })
  })

  it('drops results landing outside the grid', () => {
    const model = emptyModel()
    paintBox(model, 7, 0, 0, 7, 0, 0) // grid edge at extent 16 (half-span 8)
    const out = rotateCellsInPlane(snapshotCells(model, [encodeKey(7, 0, 0)]), PLANE, 'mirror-h', 16)
    // Single cell mirrors onto itself.
    expect(out.map((e) => e.coord)).toEqual([[7, 0, 0]])
  })

  it('mirrors horizontally about the bbox center', () => {
    const model = emptyModel()
    paintBox(model, 0, 0, 0, 0, 0, 0)
    paintBox(model, 2, 0, 0, 2, 0, 0)
    const out = rotateCellsInPlane(
      snapshotCells(model, [encodeKey(0, 0, 0), encodeKey(2, 0, 0)]),
      PLANE,
      'mirror-h',
      16,
    )
    // Symmetric pair: lands back on itself.
    expect(out.map((e) => e.coord).sort()).toEqual(
      [
        [0, 0, 0],
        [2, 0, 0],
      ].sort(),
    )
  })
})
