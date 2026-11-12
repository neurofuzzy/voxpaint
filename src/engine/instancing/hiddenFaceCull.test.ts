import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { SplitAxis, VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { buildOptimizedVoxelGroups, buildOptimizedVoxelGroupsShell } from './voxelMeshBuilder'

/**
 * Interfaces between subdivided and whole voxels are differently sized faces that exact matching
 * can't pair; the half-voxel hidden-face pass must drop them so a split voxel leaves exactly the
 * visible surface the whole voxels around it would.
 */

const S: PaletteSlotRef = { kind: 'base', index: 0 }
const T: PaletteSlotRef = { kind: 'base', index: 1 }
const GLASS: PaletteSlotRef = { kind: 'glass', index: 0 }

/** Triangle area per outward axis direction ("+x", "-y", …; "other" for sloped). */
function areaByDir(geoms: THREE.BufferGeometry[]): Record<string, number> {
  const out: Record<string, number> = {}
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (const g of geoms) {
    const pos = g.getAttribute('position')
    for (let t = 0; t < pos.count / 3; t++) {
      a.fromBufferAttribute(pos, t * 3)
      b.fromBufferAttribute(pos, t * 3 + 1)
      c.fromBufferAttribute(pos, t * 3 + 2)
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a))
      const area = n.length() / 2
      n.normalize()
      const i = [n.x, n.y, n.z].findIndex((v) => Math.abs(v) > 0.999)
      const dir = i === -1 ? 'other' : `${[n.x, n.y, n.z][i] > 0 ? '+' : '-'}${'xyz'[i]}`
      out[dir] = Math.round(((out[dir] ?? 0) + area) * 1000) / 1000
    }
  }
  return out
}

/** A 5×1×5 slab of S with the centre voxel replaced by `centre`. */
function slab(centre: (m: VoxelModel) => void): VoxelModel {
  const m = emptyModel()
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x || z) m.color.set(encodeKey(x, 0, z), { paletteSlot: S })
  centre(m)
  return { ...m, bounds: recomputeBounds(m) }
}

const split = (split: SplitAxis[], slots: Array<PaletteSlotRef | null>) => (m: VoxelModel) => {
  m.subdiv.set(encodeKey(0, 0, 0), { split, children: slots.map((s) => (s ? { slot: s } : null)) })
}

const SLAB_SURFACE = { '+x': 5, '-x': 5, '+y': 25, '-y': 25, '+z': 5, '-z': 5 }

describe('hidden faces at detail/whole seams', () => {
  for (const [label, build] of [
    ['shell', (m: VoxelModel) => buildOptimizedVoxelGroupsShell(m, DEFAULT_PALETTE)!],
    ['csg', (m: VoxelModel) => buildOptimizedVoxelGroups(m, DEFAULT_PALETTE)],
  ] as const) {
    describe(label, () => {
      it('a two-colour split voxel inside a slab leaves only the slab’s outer surface', () => {
        const { groups } = build(slab(split(['x'], [S, T])))
        expect(areaByDir(groups.map((g) => g.geometry))).toEqual(SLAB_SURFACE)
      })

      it('an eight-way split voxel inside a slab leaves only the slab’s outer surface', () => {
        const { groups } = build(slab(split(['x', 'y', 'z'], [S, T, T, S, T, S, S, T])))
        expect(areaByDir(groups.map((g) => g.geometry))).toEqual(SLAB_SURFACE)
      })

      it('differently split neighbours cancel their shared interface', () => {
        const m = emptyModel()
        m.subdiv.set(encodeKey(0, 0, 0), { split: ['x'], children: [{ slot: S }, { slot: T }] })
        m.subdiv.set(encodeKey(0, 0, 1), { split: ['y'], children: [{ slot: T }, { slot: S }] })
        const model = { ...m, bounds: recomputeBounds(m) }
        // Same outer surface as a 1×1×2 bar.
        expect(areaByDir(build(model).groups.map((g) => g.geometry))).toEqual({ '+x': 2, '-x': 2, '+y': 2, '-y': 2, '+z': 1, '-z': 1 })
      })

      it('an exposed half (empty child) keeps the neighbour faces it uncovers', () => {
        // Centre voxel has only its x-low half: the x-high half is a hole in the slab top/bottom,
        // and the neighbours' faces into that hole are visible.
        const area = areaByDir(build(slab(split(['x'], [S, null]))).groups.map((g) => g.geometry))
        expect(area['+y']).toBe(24.5)
        expect(area['-x']).toBe(5 + 1) // slab side + the +x neighbour's face into the hole
        expect(area['+x']).toBe(5 + 1) // slab side + the child's own face into the hole
      })

      it('glass: the solid face behind a glass half stays visible, the glass face goes', () => {
        const m = emptyModel()
        m.color.set(encodeKey(1, 0, 0), { paletteSlot: S })
        m.subdiv.set(encodeKey(0, 0, 0), { split: ['y'], children: [{ slot: GLASS }, { slot: GLASS }] })
        const model = { ...m, bounds: recomputeBounds(m) }
        const { groups } = build(model)
        const solid = areaByDir(groups.filter((g) => g.materialClass !== 'glass').map((g) => g.geometry))
        const glass = areaByDir(groups.filter((g) => g.materialClass === 'glass').map((g) => g.geometry))
        expect(solid['-x']).toBe(1) // the cube's face behind the glass survives
        expect(glass['+x'] ?? 0).toBe(0) // the glass face against the cube is dropped
      })
    })
  }

  it('no-cull export keeps cross-colour seams on the shell path but cancels same-colour ones', () => {
    const model = slab(split(['x'], [S, T]))
    const { groups } = buildOptimizedVoxelGroupsShell(model, DEFAULT_PALETTE, true, false)!
    const area = areaByDir(groups.map((g) => g.geometry))
    // The T half keeps its seams (and the S neighbours their faces against it): above the slab
    // surface by exactly those seams; the S half's same-colour seams cancel.
    expect(area['+x']).toBeGreaterThan(5)
    const sOnly = areaByDir(buildOptimizedVoxelGroupsShell(slab(split(['x'], [S, S])), DEFAULT_PALETTE, true, false)!.groups.map((g) => g.geometry))
    expect(sOnly).toEqual(SLAB_SURFACE)
  })
})
