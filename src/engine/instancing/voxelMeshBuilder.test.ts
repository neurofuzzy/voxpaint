import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
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

describe('coplanar merge with a pinch vertex (donut face whose ring closes through a corner)', () => {
  // A ring of cells around an empty center (0,-1) in the z=0 layer, plus one cell (-1,0,-1)
  // hanging below the ring's top-left. That removes the -z face of (-1,0,0), so the -z face at
  // z=0 is a ring-with-hole that pinches to a point at grid vertex (0,0): cells (0,0) and (-1,-1)
  // touch only diagonally there. The old shared-vertex loop extraction fused the outer boundary
  // and the hole into one loop, so earcut filled the hole. The directed half-edge walk keeps them
  // separate. Guards that the hole cell (0,-1) stays open and the ring cells stay covered.
  const ringCells: [number, number, number][] = [
    [1, 0, 0], [0, 0, 0], [-1, 0, 0],
    [-1, -1, 0], [-1, -2, 0], [-1, 0, -1],
    [0, -2, 0], [1, -2, 0], [1, -1, 0],
  ]

  function coversAtZ0NegZ(geom: THREE.BufferGeometry, px: number, py: number): boolean {
    const pos = geom.getAttribute('position')
    const nrm = geom.getAttribute('normal')
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), n = new THREE.Vector3()
    for (let t = 0; t < pos.count / 3; t++) {
      const i = t * 3
      v0.fromBufferAttribute(pos, i); v1.fromBufferAttribute(pos, i + 1); v2.fromBufferAttribute(pos, i + 2)
      n.fromBufferAttribute(nrm, i).normalize()
      if (!(n.z < -0.9 && Math.abs(v0.z) < 1e-4 && Math.abs(v1.z) < 1e-4 && Math.abs(v2.z) < 1e-4)) continue
      const d = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y)
      const a = ((v1.y - v2.y) * (px - v2.x) + (v2.x - v1.x) * (py - v2.y)) / d
      const b = ((v2.y - v0.y) * (px - v2.x) + (v0.x - v2.x) * (py - v2.y)) / d
      if (a >= -1e-6 && b >= -1e-6 && 1 - a - b >= -1e-6) return true
    }
    return false
  }

  it('leaves the enclosed hole open and keeps the surrounding ring covered', () => {
    const model = emptyModel()
    for (const [x, y, z] of ringCells) model.color.set(encodeKey(x, y, z), { paletteSlot: base0 })
    const built = buildOptimizedVoxelGroups({ ...model, bounds: recomputeBounds(model) }, DEFAULT_PALETTE)
    const geom = built.groups[0].geometry

    // The enclosed hole (0,-1) and the notch under the protrusion (-1,0) must NOT be filled.
    expect(coversAtZ0NegZ(geom, 0.5, -0.5)).toBe(false)
    expect(coversAtZ0NegZ(geom, -0.5, 0.5)).toBe(false)
    // Every ring cell exposed to -z at z=0 must be covered.
    for (const [x, y] of [[1, 0], [0, 0], [-1, -1], [-1, -2], [0, -2], [1, -2], [1, -1]]) {
      expect(coversAtZ0NegZ(geom, x + 0.5, y + 0.5)).toBe(true)
    }
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
