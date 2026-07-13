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

describe('shell pass — material boundaries', () => {
  const base0: PaletteSlotRef = { kind: 'base', index: 0 }
  const glass0: PaletteSlotRef = { kind: 'glass', index: 0 }

  it('culls the shared interface between two same-material voxels', () => {
    const built = buildOptimizedVoxelGroups(twoVoxels(base0, base0), DEFAULT_PALETTE)
    // One material class → one mesh; a 1×2 box has 6 merged quads = 12 triangles (no interior faces).
    expect(built.groups).toHaveLength(1)
    expect(built.optimizedTriangles).toBe(12)
  })

  it('keeps the solid interface face but drops the glass one at a glass↔solid boundary', () => {
    const built = buildOptimizedVoxelGroups(twoVoxels(base0, glass0), DEFAULT_PALETTE)
    // Two material classes → two meshes. The matte voxel keeps all 6 faces (12 tris); the glass voxel
    // drops its interface face (5 faces = 10 tris) to avoid z-fighting the solid face behind it = 22.
    expect(built.groups).toHaveLength(2)
    expect(built.optimizedTriangles).toBe(22)
  })

  it('keeps both interface faces between two different opaque materials', () => {
    const metal0: PaletteSlotRef = { kind: 'metal', index: 0 }
    const built = buildOptimizedVoxelGroups(twoVoxels(base0, metal0), DEFAULT_PALETTE)
    // Neither is glass, so the (hidden, internal) interface is kept on both: 12 + 12 = 24 tris.
    expect(built.groups).toHaveLength(2)
    expect(built.optimizedTriangles).toBe(24)
  })
})
