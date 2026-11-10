import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
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
})
