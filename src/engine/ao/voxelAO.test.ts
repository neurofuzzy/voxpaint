import { describe, expect, it } from 'vitest'
import { computeVoxelAO, type AOSamplePoint, type Vec3 } from './voxelAO'

const topSample = (pos: Vec3): AOSamplePoint => ({ position: pos, normal: { x: 0, y: 0, z: 1 } })

describe('computeVoxelAO', () => {
  it('leaves a sample with no occluders fully lit (1.0)', () => {
    const ao = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], [])
    expect(ao[0]).toBe(1)
  })

  it('darkens a top-facing sample under an overhanging voxel', () => {
    const ao = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], [{ x: 0, y: 0, z: 1 }])
    expect(ao[0]).toBeGreaterThan(0)
    expect(ao[0]).toBeLessThan(1)
  })

  it('gets darker as more voxels stack in front', () => {
    const one = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], [{ x: 0, y: 0, z: 1 }])
    const two = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], [
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 },
    ])
    expect(two[0]).toBeLessThan(one[0])
  })

  it('ignores voxels behind the sample plane (below a top-facing normal)', () => {
    const ao = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], [{ x: 0, y: 0, z: -1 }])
    expect(ao[0]).toBe(1)
  })

  it('ignores voxels beyond the search radius', () => {
    const ao = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], [{ x: 0, y: 0, z: 100 }], { searchRadius: 7 })
    expect(ao[0]).toBe(1)
  })

  it('always clamps the result to [0, 1] even under heavy occlusion', () => {
    const cubes: Vec3[] = []
    for (let z = 1; z <= 7; z++) for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) cubes.push({ x, y, z })
    const ao = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], cubes, { intensity: 5 })
    expect(ao[0]).toBeGreaterThanOrEqual(0)
    expect(ao[0]).toBeLessThanOrEqual(1)
  })

  it('is rotationally symmetric across the six axes for an equivalent overhang', () => {
    const cases: Array<[AOSamplePoint, Vec3]> = [
      [{ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }, { x: 0, y: 0, z: 1 }], // top
      [{ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: -1 } }, { x: 0, y: 0, z: -1 }], // bottom
      [{ position: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } }, { x: 1, y: 0, z: 0 }], // right
      [{ position: { x: 0, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } }, { x: -1, y: 0, z: 0 }], // left
      [{ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }, { x: 0, y: 1, z: 0 }], // front
      [{ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: -1, z: 0 } }, { x: 0, y: -1, z: 0 }], // back
    ]
    const values = cases.map(([sample, cube]) => computeVoxelAO([sample], [cube])[0])
    for (const v of values) expect(v).toBeCloseTo(values[0], 10)
    expect(values[0]).toBeLessThan(1) // and it actually occluded
  })

  it('respects intensity: higher intensity darkens more', () => {
    const cube: Vec3[] = [{ x: 0, y: 0, z: 1 }]
    const low = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], cube, { intensity: 0.5 })
    const high = computeVoxelAO([topSample({ x: 0, y: 0, z: 0 })], cube, { intensity: 1.5 })
    expect(high[0]).toBeLessThan(low[0])
  })
})
