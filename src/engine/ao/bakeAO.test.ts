import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { buildOptimizedVoxelGroups } from '@/engine/instancing/voxelMeshBuilder'
import { unwrapGeometries } from './uvUnwrap'
import { bakeAOToAtlas } from './bakeAO'

function bakeForModel(model: VoxelModel): { data: Uint8ClampedArray; width: number; height: number } {
  const { groups } = buildOptimizedVoxelGroups(model, DEFAULT_PALETTE)
  const atlas = groups.length > 0
    ? unwrapGeometries(groups.map((g) => g.geometry)).atlas
    : { rects: [], size: 16 }
  return bakeAOToAtlas(model, atlas)
}

function modelFrom(cells: Array<[number, number, number]>): VoxelModel {
  const model = emptyModel()
  for (const [x, y, z] of cells) {
    model.color.set(encodeKey(x, y, z), { paletteSlot: { kind: 'base', index: 0 } })
  }
  return { ...model, bounds: recomputeBounds(model) }
}

describe('bakeAOToAtlas', () => {
  it('leaves an empty model fully lit', () => {
    const { data } = bakeForModel(emptyModel())
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(255)
    }
  })

  it('leaves an isolated voxel unoccluded (all pixels lit)', () => {
    const { data } = bakeForModel(modelFrom([[0, 0, 0]]))
    let min = 255
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < min) min = data[i]
    }
    // An isolated voxel has no neighbours to occlude it — should be fully lit.
    expect(min).toBe(255)
  })

  it('darkens a voxel next to a taller neighbour (contact shadow)', () => {
    // Voxel at (0,0,0) with taller neighbour at (1,0,1): the +Z face of (0,0,0)
    // should show occlusion from the neighbour rising above it.
    const { data } = bakeForModel(modelFrom([[0, 0, 0], [1, 0, 0], [1, 0, 1]]))
    let min = 255
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < min) min = data[i]
    }
    expect(min).toBeLessThan(255)
  })

  it('produces values only in [0, 255]', () => {
    const { data } = bakeForModel(modelFrom([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 1, 1]]))
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0)
      expect(data[i]).toBeLessThanOrEqual(255)
    }
  })
})
