import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { ChamferShapeKind, Rotation, VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { buildOptimizedVoxelGroups } from '@/engine/instancing/voxelMeshBuilder'
import { unwrapGeometries, type UnwrappedAtlas } from './uvUnwrap'
import { bakeAOToAtlas, bakeOccupancyField, makeSpecularNoiseTexture } from './bakeAO'

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

describe('flats in the occupancy field', () => {
  it('treats flat panels as empty — they cast no AO on neighbours', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 0 } })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: { kind: 'base', index: 0 } })
    model.chamfer.set(encodeKey(1, 0, 0), { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'flat', rotation: 0 } })
    model.bounds = recomputeBounds(model)
    const tex = bakeOccupancyField(model)!
    const data = tex.image.data as Uint8Array
    // 2×1×1 field: the cube is occupied, the flat cell is not.
    expect(data.length).toBe(2)
    expect(data[0]).toBe(255)
    expect(data[1]).toBe(0)
  })
})

/** Single-rect atlas covering the world quad (origin + u·t1 + v·t2, (u,v) in ranges). */
function rectAtlas(
  normal: [number, number, number],
  t1: [number, number, number],
  t2: [number, number, number],
  depth: number,
  minU: number,
  maxU: number,
  minV: number,
  maxV: number,
  size = 16,
): UnwrappedAtlas {
  const tex = (a: number, b: number) => Math.ceil((b - a) * 4) + 2
  return {
    size,
    rects: [{
      normal: new THREE.Vector3(...normal),
      tangent1: new THREE.Vector3(...t1),
      tangent2: new THREE.Vector3(...t2),
      depthCoord: depth,
      minU,
      maxU,
      minV,
      maxV,
      faceIndices: [],
      atlasX: 0,
      atlasY: 0,
      texWidth: tex(minU, maxU),
      texHeight: tex(minV, maxV),
    }],
  }
}

function modelWith(cells: Array<{ coord: [number, number, number]; flat?: { shapeKind: ChamferShapeKind; rotation: Rotation } }>): VoxelModel {
  const model = emptyModel()
  for (const { coord, flat } of cells) {
    model.color.set(encodeKey(...coord), { paletteSlot: { kind: 'base', index: 0 } })
    if (flat) {
      model.chamfer.set(encodeKey(...coord), {
        planeAxis: 'z',
        planeOrientation: 1,
        resolvedTo: { shapeKind: flat.shapeKind, rotation: flat.rotation },
      })
    }
  }
  model.bounds = { min: [0, 0, -1], max: [1, 0, 1] }
  return model
}

describe('flats in the AO bake', () => {
  // The +x face of the cube at the origin (world plane x=1, y,z in [0,1]).
  const cubeFace = () => rectAtlas([1, 0, 0], [0, 1, 0], [0, 0, 1], 1, 0, 1, 0, 1)

  it('does not darken a face backing onto a flat cell (no casting)', () => {
    const alone = bakeAOToAtlas(modelWith([{ coord: [0, 0, 0] }]), cubeFace())
    const withFlat = bakeAOToAtlas(
      modelWith([{ coord: [0, 0, 0] }, { coord: [1, 0, 0], flat: { shapeKind: 'flat', rotation: 0 } }]),
      cubeFace(),
    )
    // Byte-identical: the flat might as well not be there.
    expect(withFlat.data).toEqual(alone.data)
  })

  it('control: a solid neighbour does darken the same face', () => {
    const alone = bakeAOToAtlas(modelWith([{ coord: [0, 0, 0] }]), cubeFace())
    const withCube = bakeAOToAtlas(modelWith([{ coord: [0, 0, 0] }, { coord: [1, 0, 0] }]), cubeFace())
    let min = 255
    for (let i = 0; i < withCube.data.length; i += 4) min = Math.min(min, withCube.data[i])
    expect(min).toBeLessThan(255)
    expect(alone.data).not.toEqual(withCube.data)
  })

  it('bakes flat-quad texels constant white even next to a wall (no receiving)', () => {
    // Rect on the flat quad itself (world plane z=0.5 over the flat cell x in [1,2], y in [0,1]),
    // with solid cubes directly ahead at z=1 and behind at z=-1.
    const pane = () => rectAtlas([0, 0, 1], [1, 0, 0], [0, 1, 0], 0.5, 1, 2, 0, 1)
    const walled = modelWith([
      { coord: [1, 0, 0], flat: { shapeKind: 'flat', rotation: 0 } },
      { coord: [1, 0, 1] },
      { coord: [1, 0, -1] },
    ])
    const { data } = bakeAOToAtlas(walled, pane())
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(255)
    }
  })

  it('control: a solid face in the same walled setup does darken', () => {
    // Same walls, but the rect sits on a solid cube's +z face at z=1 (cube at (1,0,0), no flat):
    // the wall at z=1... the face backs onto (1,0,1)'s region — it must catch shadow.
    const solidFace = () => rectAtlas([0, 0, 1], [1, 0, 0], [0, 1, 0], 1, 1, 2, 0, 1)
    const walled = modelWith([{ coord: [1, 0, 0] }, { coord: [1, 0, 1] }, { coord: [1, 0, -1] }])
    const { data } = bakeAOToAtlas(walled, solidFace())
    let min = 255
    for (let i = 0; i < data.length; i += 4) min = Math.min(min, data[i])
    expect(min).toBeLessThan(255)
  })

  it('bakes flatwedge-quad texels constant white (diagonal plane + facing)', () => {
    // Rotation-0 diagonal of the (1,0,0) cell on the z plane (v runs toward −y, so the prefab
    // NW-SE diagonal lands on the world x+y=2 plane), normal (1,1,0)/√2.
    const s = Math.SQRT1_2
    const diag = () => rectAtlas([s, s, 0], [s, -s, 0], [0, 0, 1], Math.SQRT2, 0, 2 * s, 0, 1)
    const walled = modelWith([
      { coord: [1, 0, 0], flat: { shapeKind: 'flatwedge', rotation: 0 } },
      { coord: [2, 0, 0] },
    ])
    const { data } = bakeAOToAtlas(walled, diag())
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(255)
    }
  })
})
