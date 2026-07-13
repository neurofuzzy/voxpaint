import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { FACE_ATLAS_CELL } from '@/engine/texture/boxMapping'
import { FACE_SIZE } from '@/engine/texture/types'
import { bakeAOAtlas } from './bakeAO'

function modelFrom(cells: Array<[number, number, number]>): VoxelModel {
  const model = emptyModel()
  for (const [x, y, z] of cells) model.color.set(encodeKey(x, y, z), { paletteSlot: { kind: 'base', index: 0 } })
  return { ...model, bounds: recomputeBounds(model) }
}

/** Min grayscale value within one box face's region of the atlas (255 = fully lit / no occlusion). */
function minInFace(data: Uint8ClampedArray, width: number, face: keyof typeof FACE_ATLAS_CELL): number {
  const { col, row } = FACE_ATLAS_CELL[face]
  let min = 255
  for (let tv = 0; tv < FACE_SIZE; tv++) {
    for (let tu = 0; tu < FACE_SIZE; tu++) {
      const px = ((row * FACE_SIZE + tv) * width + (col * FACE_SIZE + tu)) * 4
      if (data[px] < min) min = data[px]
    }
  }
  return min
}

describe('bakeAOAtlas', () => {
  it('leaves an empty model fully lit', () => {
    const { data } = bakeAOAtlas(emptyModel())
    expect(data.every((v, i) => (i % 4 === 3 ? v === 255 : v === 255))).toBe(true)
  })

  it('leaves an isolated voxel unoccluded (all faces lit)', () => {
    const { data, width } = bakeAOAtlas(modelFrom([[0, 0, 0]]))
    for (const face of Object.keys(FACE_ATLAS_CELL) as (keyof typeof FACE_ATLAS_CELL)[]) {
      expect(minInFace(data, width, face)).toBe(255)
    }
  })

  it('darkens a voxel top next to a taller neighbour (step contact shadow)', () => {
    // Base voxel at (0,0,0); neighbour column one taller at x=1. The base top (frontmost in its own
    // column) is occluded near the x=1 edge by the raised neighbour voxel (1,0,1) — a different column,
    // so no box-map depth ambiguity.
    const { data, width } = bakeAOAtlas(modelFrom([[0, 0, 0], [1, 0, 0], [1, 0, 1]]))
    expect(minInFace(data, width, 'pz')).toBeLessThan(255)
  })

  it('produces values only in [0, 255]', () => {
    const { data } = bakeAOAtlas(modelFrom([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 1, 1]]))
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0)
      expect(data[i]).toBeLessThanOrEqual(255)
    }
  })
})
