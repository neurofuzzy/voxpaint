import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { buildOptimizedVoxelGroups } from '@/engine/instancing/voxelMeshBuilder'
import { unwrapGeometries, type UnwrappedAtlas } from './uvUnwrap'
import { bakeAOToAtlas, makeSpecularNoiseTexture } from './bakeAO'

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

/** Mirrors bakeAO's PADDING: rect texels with tx/ty inside [PADDING, texSize - PADDING) hold baked
 * values, the one-texel rim stays at the 255 fill. */
const PADDING = 1

function atlasForModel(model: VoxelModel): UnwrappedAtlas {
  const { groups } = buildOptimizedVoxelGroups(model, DEFAULT_PALETTE)
  return unwrapGeometries(groups.map((g) => g.geometry)).atlas
}

/** R-channel values of every interior (non-padding) texel, grouped by rect-relative bs×bs block.
 * Voxel vertices sit on integer coordinates, so world-texel block boundaries align with
 * rect-relative bs multiples and every block in the map is a full bs×bs square. */
function interiorBlocks(atlas: UnwrappedAtlas, data: Uint8ClampedArray, size: number, bs: number): Map<string, number[]> {
  const blocks = new Map<string, number[]>()
  for (const rect of atlas.rects) {
    for (let ty = PADDING; ty < rect.texHeight - PADDING; ty++) {
      for (let tx = PADDING; tx < rect.texWidth - PADDING; tx++) {
        const key = `${rect.atlasX},${rect.atlasY},${Math.floor((tx - PADDING) / bs)},${Math.floor((ty - PADDING) / bs)}`
        const value = data[((rect.atlasY + ty) * size + (rect.atlasX + tx)) * 4]
        const arr = blocks.get(key)
        if (arr) arr.push(value)
        else blocks.set(key, [value])
      }
    }
  }
  return blocks
}

describe('noiseScale quantization', () => {
  // aoStrength 0 isolates the grain: shaded is flat 1 everywhere, so every interior texel reads
  // round((1 − hash) × 255) — pure noise, no occlusion shading to blur block edges.
  const model = modelFrom([[0, 0, 0]])

  it('bakes 2x2 constant blocks at scale 2 (nearest, not blurred)', () => {
    const atlas = atlasForModel(model)
    const { data, width } = bakeAOToAtlas(model, atlas, 1, 0, undefined, 7, 2)
    const blocks = interiorBlocks(atlas, data, width, 2)
    expect(blocks.size).toBeGreaterThan(1)
    for (const values of blocks.values()) {
      expect(new Set(values).size).toBe(1)
    }
    // The grain still varies block to block.
    expect(new Set([...blocks.values()].map((v) => v[0])).size).toBeGreaterThan(1)
  })

  it('bakes 4x4 constant blocks at scale 4', () => {
    const atlas = atlasForModel(model)
    const { data, width } = bakeAOToAtlas(model, atlas, 1, 0, undefined, 7, 4)
    const blocks = interiorBlocks(atlas, data, width, 4)
    expect(blocks.size).toBeGreaterThan(1)
    for (const values of blocks.values()) {
      expect(new Set(values).size).toBe(1)
    }
    expect(new Set([...blocks.values()].map((v) => v[0])).size).toBeGreaterThan(1)
  })

  it('keeps per-texel grain at scale 1 (adjacent texels differ)', () => {
    const atlas = atlasForModel(model)
    const { data, width } = bakeAOToAtlas(model, atlas, 1, 0, undefined, 7, 1)
    let differingAdjacentPairs = 0
    for (const rect of atlas.rects) {
      for (let ty = PADDING; ty < rect.texHeight - PADDING; ty++) {
        for (let tx = PADDING; tx < rect.texWidth - PADDING - 1; tx++) {
          const a = data[((rect.atlasY + ty) * width + (rect.atlasX + tx)) * 4]
          const b = data[((rect.atlasY + ty) * width + (rect.atlasX + tx + 1)) * 4]
          if (a !== b) differingAdjacentPairs++
        }
      }
    }
    expect(differingAdjacentPairs).toBeGreaterThan(0)
  })

  it('quantizes the specular metal grain the same way', () => {
    const atlas = atlasForModel(model)
    const spec = makeSpecularNoiseTexture(atlas, 1, 7, 2)
    const blocks = interiorBlocks(atlas, spec.metalness.data, spec.metalness.width, 2)
    expect(blocks.size).toBeGreaterThan(1)
    for (const values of blocks.values()) {
      expect(new Set(values).size).toBe(1)
    }
    expect(new Set([...blocks.values()].map((v) => v[0])).size).toBeGreaterThan(1)
  })
})
