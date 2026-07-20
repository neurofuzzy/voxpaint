import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import type { Axis, Orientation } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { applyClipboardAt } from '@/engine/tools/clipboard'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { ClipboardData } from '@/store/types'
import { buildFloatGhostBatches } from './floatGhost'
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
    for (const b of batches) expect(b.colors.length).toBe(b.matrices.length)
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
