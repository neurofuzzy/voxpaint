import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import type { Axis, Orientation } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { applyClipboardAt } from '@/engine/tools/clipboard'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { ClipboardData, SelectionRegion } from '@/store/types'
import { buildFloatGhostBatches, buildSelectionHighlightBatches } from './ghostBatches'
import { cubeInstanceMatrix } from './basis'

const EXTENT = 16
const palette = DEFAULT_PALETTE
const origin = { originU: 1, originV: 2 }

const slot = { kind: 'base', index: 3 } as const

function floatOf(cells: ClipboardData['cells']): ClipboardData {
  return { width: 3, height: 2, cells }
}

const ALL_PLANES: ConstructionPlane[] = (['x', 'y', 'z'] as const).flatMap((axis: Axis) =>
  ([1, -1] as const).map((orientation: Orientation) => ({ axis, orientation, offset: 0 })),
)

/** World-space translation of an instance matrix — a cell's 3D center. */
function positionOf(m: THREE.Matrix4): [number, number, number] {
  const p = new THREE.Vector3().setFromMatrixPosition(m)
  return [p.x, p.y, p.z]
}

describe('buildFloatGhostBatches', () => {
  it('returns nothing when there is no float', () => {
    expect(buildFloatGhostBatches(null, null, ALL_PLANES[0], palette, EXTENT)).toEqual([])
    expect(buildFloatGhostBatches(floatOf([]), null, ALL_PLANES[0], palette, EXTENT)).toEqual([])
  })

  it('ghosts exactly the cells the bake would write, on every plane', () => {
    // The property that makes the ghost trustworthy: it previews the bake rather than approximating
    // it. Compare against applyClipboardAt — the real thing — cell centre for cell centre.
    const cells = [
      { du: 0, dv: 0, color: { paletteSlot: slot } },
      { du: 2, dv: 1, color: { paletteSlot: slot } },
    ]
    for (const plane of ALL_PLANES) {
      const model = emptyModel()
      applyClipboardAt(model, plane, floatOf(cells), origin.originU, origin.originV, EXTENT)

      const ghosted = buildFloatGhostBatches(floatOf(cells), origin, plane, palette, EXTENT)
        .flatMap((b) => b.matrices.map(positionOf))
        .map(([x, y, z]) => encodeKey(Math.floor(x), Math.floor(y), Math.floor(z)))
        .sort()

      expect(ghosted).toEqual([...model.color.keys()].sort())
    }
  })

  it('skips cells with no color, which bake to nothing', () => {
    const batches = buildFloatGhostBatches(floatOf([{ du: 0, dv: 0 }]), origin, ALL_PLANES[0], palette, EXTENT)
    expect(batches).toEqual([])
  })

  it('drops off-grid cells rather than promising a bake that will not happen', () => {
    const plane = ALL_PLANES[0]
    const farOrigin = { originU: 900, originV: 900 }
    const cells = [{ du: 0, dv: 0, color: { paletteSlot: slot } }]

    const model = emptyModel()
    applyClipboardAt(model, plane, floatOf(cells), farOrigin.originU, farOrigin.originV, EXTENT)
    expect(model.color.size).toBe(0)

    expect(buildFloatGhostBatches(floatOf(cells), farOrigin, plane, palette, EXTENT)).toEqual([])
  })

  it('groups cells by pool so each batch shares one geometry', () => {
    const plane: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0 }
    const batches = buildFloatGhostBatches(
      floatOf([
        { du: 0, dv: 0, color: { paletteSlot: slot } },
        { du: 1, dv: 0, color: { paletteSlot: slot } },
        {
          du: 2,
          dv: 0,
          color: { paletteSlot: slot },
          chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } },
        },
      ]),
      origin,
      plane,
      palette,
      EXTENT,
    )

    const byPool = Object.fromEntries(batches.map((b) => [b.poolId, b.matrices.length]))
    expect(byPool.cube).toBe(2)
    // +Z is a reflected-basis plane, so its chamfers use the v-mirrored pool (see pools.ts).
    expect(byPool.rampM).toBe(1)
    // Float ghosts always carry per-instance colors (unlike the flat-tinted selection cast).
    for (const b of batches) expect(b.colors).toHaveLength(b.matrices.length)
  })

  it('places an unchamfered cell at the same matrix the live renderer would', () => {
    const plane: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0 }
    const [batch] = buildFloatGhostBatches(floatOf([{ du: 0, dv: 0, color: { paletteSlot: slot } }]), origin, plane, palette, EXTENT)
    const model = emptyModel()
    applyClipboardAt(model, plane, floatOf([{ du: 0, dv: 0, color: { paletteSlot: slot } }]), origin.originU, origin.originV, EXTENT)
    const [key] = [...model.color.keys()]
    const coord = key.split(',').map(Number) as [number, number, number]
    expect(positionOf(batch.matrices[0])).toEqual(positionOf(cubeInstanceMatrix(coord)))
  })
})

describe('buildSelectionHighlightBatches', () => {
  const plane: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0 }

  /** Fills the model at every (u,v) listed, on `plane`. */
  function modelWith(cells: Array<[number, number]>) {
    const model = emptyModel()
    for (const [u, v] of cells) {
      model.color.set(encodeKey(...gridCoordFromPixel(plane, u, v)), { paletteSlot: slot })
    }
    return model
  }

  function rect(originU: number, originV: number, width: number, height: number): SelectionRegion {
    return { originU, originV, width, height, mask: new Uint8Array(width * height).fill(1) }
  }

  const count = (batches: ReturnType<typeof buildSelectionHighlightBatches>) =>
    batches.reduce((n, b) => n + b.matrices.length, 0)

  it('returns nothing without a selection', () => {
    expect(buildSelectionHighlightBatches(modelWith([[0, 0]]), plane, null, EXTENT)).toEqual([])
  })

  it('casts only over cells that actually hold a voxel', () => {
    // 2x2 selection over a plane holding just one voxel — the other three are empty space and
    // would read as a floating cyan slab if included.
    const model = modelWith([[0, 0]])
    expect(count(buildSelectionHighlightBatches(model, plane, rect(0, 0, 2, 2), EXTENT))).toBe(1)
  })

  it('respects the mask, not just the bounding box', () => {
    const model = modelWith([
      [0, 0],
      [1, 0],
    ])
    const lasso = rect(0, 0, 2, 1)
    lasso.mask[1] = 0 // deselect (du=1, dv=0)
    expect(count(buildSelectionHighlightBatches(model, plane, lasso, EXTENT))).toBe(1)
  })

  it('carries no per-instance colors — the cast is one flat tint', () => {
    const batches = buildSelectionHighlightBatches(modelWith([[0, 0]]), plane, rect(0, 0, 1, 1), EXTENT)
    expect(batches[0].colors).toBeUndefined()
  })

  it('highlights a voxel at the same place the live renderer draws it', () => {
    const coord = gridCoordFromPixel(plane, 2, 3)
    const model = modelWith([[2, 3]])
    const [batch] = buildSelectionHighlightBatches(model, plane, rect(2, 3, 1, 1), EXTENT)
    expect(positionOf(batch.matrices[0])).toEqual(positionOf(cubeInstanceMatrix(coord)))
  })

  it('uses a chamfered voxel\'s own baked shape, not a cube', () => {
    const model = modelWith([[0, 0]])
    const key = encodeKey(...gridCoordFromPixel(plane, 0, 0))
    model.chamfer.set(key, { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } })
    const batches = buildSelectionHighlightBatches(model, plane, rect(0, 0, 1, 1), EXTENT)
    // +Z is a reflected-basis plane, so its chamfers use the v-mirrored pool (see pools.ts).
    expect(batches.map((b) => b.poolId)).toEqual(['rampM'])
  })

  it('ignores selection cells that fall outside the working grid', () => {
    expect(buildSelectionHighlightBatches(modelWith([[0, 0]]), plane, rect(900, 900, 2, 2), EXTENT)).toEqual([])
  })
})
