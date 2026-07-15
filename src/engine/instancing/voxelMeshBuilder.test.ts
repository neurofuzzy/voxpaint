import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { triangleCount } from './meshOptimizer'
import { buildOptimizedVoxelGroups } from './voxelMeshBuilder'

function twoVoxels(a: PaletteSlotRef, b: PaletteSlotRef): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(0, 0, 0), { paletteSlot: a })
  model.color.set(encodeKey(1, 0, 0), { paletteSlot: b }) // adjacent along +x
  return { ...model, bounds: recomputeBounds(model) }
}

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
const base1: PaletteSlotRef = { kind: 'base', index: 1 }
const glass0: PaletteSlotRef = { kind: 'glass', index: 0 }
const glass1: PaletteSlotRef = { kind: 'glass', index: 1 }
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

  it('keeps matte and metal voxels in separate groups with all faces intact (occupancy culling is glass-only)', () => {
    const built = buildOptimizedVoxelGroups(twoVoxels(base0, metal0), DEFAULT_PALETTE)
    expect(built.groups).toHaveLength(2)
    expect(built.rawTriangles).toBe(24)
    expect(built.optimizedTriangles).toBe(24)
  })
})

describe('glass occupancy culling (rough grid test, not triangle matching)', () => {
  it('drops a glass voxel\'s face where it touches an adjacent matte voxel, but keeps the matte voxel whole', () => {
    const built = buildOptimizedVoxelGroups(twoVoxels(base0, glass0), DEFAULT_PALETTE)
    // Different materialClass → still two separate CSG groups (never unioned together).
    expect(built.groups).toHaveLength(2)
    expect(built.rawTriangles).toBe(24)
    // The glass cube's one face touching the matte neighbour is culled (2 tris); the matte cube,
    // and the rest of the glass cube, are untouched: 12 (matte) + 10 (glass) = 22.
    expect(built.optimizedTriangles).toBe(22)
  })

  it('drops a glass voxel\'s face where it touches an adjacent metal voxel', () => {
    const built = buildOptimizedVoxelGroups(twoVoxels(metal0, glass0), DEFAULT_PALETTE)
    expect(built.optimizedTriangles).toBe(22)
  })

  it('drops the touching face on BOTH sides when two differently-coloured glass voxels are adjacent', () => {
    // Different colours → separate CSG groups, so the shared face isn't cancelled by the union
    // itself (that only happens within a group) — each side loses its own face to the occupancy cull.
    const built = buildOptimizedVoxelGroups(twoVoxels(glass0, glass1), DEFAULT_PALETTE)
    expect(built.groups).toHaveLength(2)
    expect(built.rawTriangles).toBe(24)
    expect(built.optimizedTriangles).toBe(20)
  })

  it('keeps all faces of an isolated glass voxel with no neighbours', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: glass0 })
    model.color.set(encodeKey(5, 0, 0), { paletteSlot: base1 }) // far away, not touching
    const built = buildOptimizedVoxelGroups({ ...model, bounds: recomputeBounds(model) }, DEFAULT_PALETTE)
    const glassGroup = built.groups.find((g) => g.materialClass === 'glass')!
    expect(built.rawTriangles).toBe(24)
    expect(built.optimizedTriangles).toBe(24)
    expect(glassGroup).toBeDefined()
  })

  it('does NOT cull a glass face touching a RESOLVED chamfer voxel — it doesn\'t fully occupy its cell', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: glass0 })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    model.chamfer.set(encodeKey(1, 0, 0), { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } })
    const built = buildOptimizedVoxelGroups({ ...model, bounds: recomputeBounds(model) }, DEFAULT_PALETTE)
    const glassGroup = built.groups.find((g) => g.materialClass === 'glass')!
    expect(triangleCount(glassGroup.geometry)).toBe(12) // full cube, untouched
  })

  it('still culls a glass face touching an UNRESOLVED chamfer voxel — it renders as a plain cube', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: glass0 })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    model.chamfer.set(encodeKey(1, 0, 0), { planeAxis: 'z', planeOrientation: 1, resolvedTo: null })
    const built = buildOptimizedVoxelGroups({ ...model, bounds: recomputeBounds(model) }, DEFAULT_PALETTE)
    const glassGroup = built.groups.find((g) => g.materialClass === 'glass')!
    expect(triangleCount(glassGroup.geometry)).toBe(10) // one face (2 tris) culled
  })
})
