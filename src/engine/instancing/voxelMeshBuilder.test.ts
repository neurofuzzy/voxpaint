import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { buildOptimizedVoxelGroups } from './voxelMeshBuilder'

function twoVoxels(a: PaletteSlotRef, b: PaletteSlotRef): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(0, 0, 0), { paletteSlot: a })
  model.color.set(encodeKey(1, 0, 0), { paletteSlot: b }) // adjacent along +x
  return { ...model, bounds: recomputeBounds(model) }
}

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
const glass0: PaletteSlotRef = { kind: 'glass', index: 0 }
const metal0: PaletteSlotRef = { kind: 'metal', index: 0 }

describe('CSG per-color-group optimizer', () => {
  it('unions two adjacent same-colour voxels into a single group with interior faces removed', () => {
    const built = buildOptimizedVoxelGroups(twoVoxels(base0, base0), DEFAULT_PALETTE)
    // Same materialClass + same colour → one CSG group.
    expect(built.groups).toHaveLength(1)
    // Raw: 2 cubes × 12 tris = 24. CSG union removes the shared interior face.
    expect(built.rawTriangles).toBe(24)
    expect(built.optimizedTriangles).toBeLessThan(24)
  })

  it('keeps glass and matte voxels in separate groups with all faces intact', () => {
    const built = buildOptimizedVoxelGroups(twoVoxels(base0, glass0), DEFAULT_PALETTE)
    // Different materialClass → two CSG groups.
    expect(built.groups).toHaveLength(2)
    expect(built.rawTriangles).toBe(24)
    // Each group has one voxel — no interior face removal across groups.
    expect(built.optimizedTriangles).toBe(24)
  })

  it('keeps matte and metal voxels in separate groups', () => {
    const built = buildOptimizedVoxelGroups(twoVoxels(base0, metal0), DEFAULT_PALETTE)
    expect(built.groups).toHaveLength(2)
    expect(built.rawTriangles).toBe(24)
    expect(built.optimizedTriangles).toBe(24)
  })
})
