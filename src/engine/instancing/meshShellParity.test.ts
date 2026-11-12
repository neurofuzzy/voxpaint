import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import { subdivideCell } from '@/engine/grid/subdiv'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { triangleCount } from './meshOptimizer'
import { buildOptimizedVoxelGroups, buildOptimizedVoxelGroupsShell, type ColorGroupGeometry } from './voxelMeshBuilder'
import { CORPUS } from './meshBenchCorpus'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
const glass0: PaletteSlotRef = { kind: 'glass', index: 0 }

function bevelModel(shapeKind: 'ramp' | 'convex' | 'concave' | 'wedge' | 'thin' | 'half' | 'post' | 'quarter'): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
  model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
  model.chamfer.set(encodeKey(1, 0, 0), { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind, rotation: 0 } })
  return { ...model, bounds: recomputeBounds(model) }
}

function groupTriCounts(groups: ColorGroupGeometry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const g of groups) out.set(`${g.materialClass}:${g.colorKey}`, triangleCount(g.geometry))
  return out
}

/** Total triangle area per outward axis direction ("+x", "-y", …; "other" for sloped). */
function surfaceByDir(geoms: THREE.BufferGeometry[]): Record<string, number> {
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

describe('shell fast path parity with CSG', () => {
  // The chamfer-field corpus case exercises bevels, which the shell path declines.
  const eligible = CORPUS.filter((c) => c.name !== 'chamfer-8x8(64)')
  for (const merge of [false, true]) {
    it(`matches CSG group counts and triangles on the eligible corpus (merge=${merge})`, () => {
      for (const { name, build } of eligible) {
        const model = build()
        const csg = buildOptimizedVoxelGroups(model, DEFAULT_PALETTE, merge)
        const shell = buildOptimizedVoxelGroupsShell(model, DEFAULT_PALETTE, merge)
        expect(shell, `${name}: shell should handle full-footprint models`).not.toBeNull()
        expect(shell!.groups.length, `${name}: group count`).toBe(csg.groups.length)
        expect(shell!.rawTriangles, `${name}: raw`).toBe(csg.rawTriangles)
        expect(shell!.optimizedTriangles, `${name}: optimized`).toBe(csg.optimizedTriangles)
        const shellGroups = groupTriCounts(shell!.groups)
        const csgGroups = groupTriCounts(csg.groups)
        expect([...shellGroups.entries()].sort(), `${name}: per-group tris`).toEqual([...csgGroups.entries()].sort())
        for (const g of shell!.groups) g.geometry.dispose()
        for (const g of csg.groups) g.geometry.dispose()
      }
    })
  }

  it('declines the bevel corpus case, falling back to CSG', () => {
    const chamfer = CORPUS.find((c) => c.name === 'chamfer-8x8(64)')!
    expect(buildOptimizedVoxelGroupsShell(chamfer.build(), DEFAULT_PALETTE)).toBeNull()
  })

  it('culls glass against an unresolved chamfer exactly like CSG (renders as a cube)', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: glass0 })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    model.chamfer.set(encodeKey(1, 0, 0), { planeAxis: 'z', planeOrientation: 1, resolvedTo: null })
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    const csg = buildOptimizedVoxelGroups(withBounds, DEFAULT_PALETTE)
    const shell = buildOptimizedVoxelGroupsShell(withBounds, DEFAULT_PALETTE)
    expect(shell).not.toBeNull()
    expect(shell!.optimizedTriangles).toBe(csg.optimizedTriangles)
    const glass = shell!.groups.find((g) => g.materialClass === 'glass')!
    expect(triangleCount(glass.geometry)).toBe(10)
    for (const g of shell!.groups) g.geometry.dispose()
    for (const g of csg.groups) g.geometry.dispose()
  })

  it('returns null for resolved bevels, falling back to CSG', () => {
    for (const kind of ['ramp', 'convex', 'concave', 'wedge', 'thin', 'half', 'post', 'quarter'] as const) {
      const shell = buildOptimizedVoxelGroupsShell(bevelModel(kind), DEFAULT_PALETTE)
      expect(shell, kind).toBeNull()
    }
  })

    it('resolves flat panes exactly like the CSG flat pass', () => {

    const model = emptyModel()
    for (const x of [0, 1]) {
      model.color.set(encodeKey(x, 0, 0), { paletteSlot: base0 })
      model.chamfer.set(encodeKey(x, 0, 0), { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'flat', rotation: 0 } })
    }
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    const csg = buildOptimizedVoxelGroups(withBounds, DEFAULT_PALETTE)
    const shell = buildOptimizedVoxelGroupsShell(withBounds, DEFAULT_PALETTE)
    expect(shell).not.toBeNull()
    expect(shell!.optimizedTriangles).toBe(4)
    expect(shell!.optimizedTriangles).toBe(csg.optimizedTriangles)
    for (const g of shell!.groups) g.geometry.dispose()
    for (const g of csg.groups) g.geometry.dispose()
  })

  it('builds a subdivided cube back into the same 12-triangle surface, both paths', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(subdivideCell(model, [0, 0, 0])).toBe(true)
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    const csg = buildOptimizedVoxelGroups(withBounds, DEFAULT_PALETTE)
    const shell = buildOptimizedVoxelGroupsShell(withBounds, DEFAULT_PALETTE)
    expect(shell).not.toBeNull()
    // 8 half-cubes in, interior faces cancelled, outer faces re-welded: one group, 12 tris.
    expect(csg.rawTriangles).toBe(8 * 12)
    expect(shell!.groups.length).toBe(1)
    expect(shell!.optimizedTriangles).toBe(12)
    expect(shell!.optimizedTriangles).toBe(csg.optimizedTriangles)
    for (const g of shell!.groups) g.geometry.dispose()
    for (const g of csg.groups) g.geometry.dispose()
  })

  it('matches CSG on mixed full/detail seams (2x2 slab, one cell subdivided)', () => {
    // Mixed seams triangulate differently: the CSG union splits neighbor faces at half-planes
    // (and can leave an unpaired hidden interior quad — a known ThreeBSP wart at exact-half
    // coordinates), while the shell drops every hidden partial-overlap seam via the half-voxel
    // hidden-face pass. The assertion is exterior-surface equivalence, not tri equality.
    const model = emptyModel()
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      model.color.set(encodeKey(x, 0, z), { paletteSlot: base0 })
    }
    expect(subdivideCell(model, [0, 0, 0])).toBe(true)
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    for (const merge of [false, true]) {
      const csg = buildOptimizedVoxelGroups(withBounds, DEFAULT_PALETTE, merge)
      const shell = buildOptimizedVoxelGroupsShell(withBounds, DEFAULT_PALETTE, merge)
      expect(shell, `merge=${merge}: shell handles mixed seams`).not.toBeNull()
      expect(shell!.groups.length, `merge=${merge}: group count`).toBe(csg.groups.length)
      // The shell keeps no hidden seam faces: its total surface is exactly the slab's outer
      // surface (2×1×2: 4 top, 4 bottom, 2 per side), per outward direction.
      expect(surfaceByDir(shell!.groups.map((g) => g.geometry)), `merge=${merge}: shell surface`).toEqual({ '+x': 2, '-x': 2, '+y': 4, '-y': 4, '+z': 2, '-z': 2 })
      // Exterior equivalence: rays from every side (including through the subdivided cell's
      // quarter-faces) first-hit at identical distances on both meshes.
      const rays: Array<[origin: [number, number, number], dir: [number, number, number]]> = [
        [[-1, 0.5, 0.5], [1, 0, 0]],
        [[-1, 0.25, 0.25], [1, 0, 0]],
        [[3, 0.5, 1.5], [-1, 0, 0]],
        [[0.5, -1, 0.5], [0, 1, 0]],
        [[0.25, -1, 1.75], [0, 1, 0]],
        [[0.5, 0.5, -1], [0, 0, 1]],
        [[1.5, 0.5, 3], [0, 0, -1]],
        [[0.5, 3, 0.5], [0, -1, 0]],
      ]
      for (const [o, d] of rays) {
        const origin = new THREE.Vector3(...o)
        const dir = new THREE.Vector3(...d)
        const hitCsg = new THREE.Raycaster(origin, dir).intersectObject(new THREE.Mesh(csg.groups[0].geometry), false)[0]
        const hitShell = new THREE.Raycaster(origin, dir).intersectObject(new THREE.Mesh(shell!.groups[0].geometry), false)[0]
        expect(hitCsg, `merge=${merge}: csg hit ${o}`).toBeDefined()
        expect(hitShell, `merge=${merge}: shell hit ${o}`).toBeDefined()
        expect(hitShell.distance, `merge=${merge}: surface match ${o}`).toBeCloseTo(hitCsg.distance, 9)
      }
      for (const g of shell!.groups) g.geometry.dispose()
      for (const g of csg.groups) g.geometry.dispose()
    }
  })
})

describe('detail bevels (scaled chamfers)', () => {
  const rampChild = {
    slot: { kind: 'base', index: 0 } as const,
    chamfer: { planeAxis: 'y' as const, planeOrientation: 1 as const, resolvedTo: { shapeKind: 'ramp' as const, rotation: 0 as const } },
  }

  it('unions a scaled ramp child to the exact sloped solid', () => {
    // A u-split child (0.5×1×1) holding a ramp stretched 2:1 renders the same sloped solid
    // as a half-scale unit ramp would at that footprint — watertight against a matching
    // neighbor half. Raycast the slope from above: hits must land on the y=x/2 plane.
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    expect(subdivideCell(model, [0, 0, 0], ['x', 'z'])).toBe(true)
    const sub = model.subdiv.get(encodeKey(0, 0, 0))!
    // Paint every child the flat slot, then give the SW quarter a ramp.
    for (let i = 0; i < 4; i++) sub.children[i] = { slot: { kind: 'base', index: 0 } }
    sub.children[0] = { slot: { kind: 'base', index: 0 }, chamfer: rampChild.chamfer }
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    const csg = buildOptimizedVoxelGroups(withBounds, DEFAULT_PALETTE)
    expect(csg.groups.length).toBe(1)
    // The shell path declines scaled bevels (partial overlaps can't triple-match).
    expect(buildOptimizedVoxelGroupsShell(withBounds, DEFAULT_PALETTE)).toBeNull()
    // Exterior sanity: the solid occupies exactly the parent cube's footprint.
    const geom = csg.groups[0].geometry
    const box = new THREE.Box3().setFromObject(new THREE.Mesh(geom))
    expect(box.min.toArray().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 0])
    expect(box.max.toArray().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 1, 1])
    for (const g of csg.groups) g.geometry.dispose()
  })

  it('welds a partial-split slab exactly like its full-size counterpart', () => {
    // A u-split of one cell of a 2x2 slab: the shell (cubes only) keeps the shell/CSG
    // exterior identical — CSG triangulates the mixed seam differently (BSP splits neighbor
    // faces at half-planes), so the assertion is exterior-surface equivalence, not tri equality.
    const model = emptyModel()
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      model.color.set(encodeKey(x, 0, z), { paletteSlot: base0 })
    }
    expect(subdivideCell(model, [0, 0, 0], ['x'])).toBe(true)
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    const csg = buildOptimizedVoxelGroups(withBounds, DEFAULT_PALETTE, false)
    const shell = buildOptimizedVoxelGroupsShell(withBounds, DEFAULT_PALETTE, false)
    expect(shell).not.toBeNull()
    expect(shell!.groups.length).toBe(csg.groups.length)
    const rays: Array<[origin: [number, number, number], dir: [number, number, number]]> = [
      [[-1, 0.5, 0.5], [1, 0, 0]],
      [[-1, 0.25, 0.75], [1, 0, 0]],
      [[3, 0.5, 1.5], [-1, 0, 0]],
      [[0.5, -1, 0.5], [0, 1, 0]],
      [[0.5, 0.5, -1], [0, 0, 1]],
      [[0.5, 3, 0.5], [0, -1, 0]],
    ]
    for (const [o, d] of rays) {
      const origin = new THREE.Vector3(...o)
      const dir = new THREE.Vector3(...d)
      const hitCsg = new THREE.Raycaster(origin, dir).intersectObject(new THREE.Mesh(csg.groups[0].geometry), false)[0]
      const hitShell = new THREE.Raycaster(origin, dir).intersectObject(new THREE.Mesh(shell!.groups[0].geometry), false)[0]
      expect(hitCsg, `csg hit ${o}`).toBeDefined()
      expect(hitShell, `shell hit ${o}`).toBeDefined()
      expect(hitShell.distance, `surface match ${o}`).toBeCloseTo(hitCsg.distance, 9)
    }
    for (const g of shell!.groups) g.geometry.dispose()
    for (const g of csg.groups) g.geometry.dispose()
  })
})
