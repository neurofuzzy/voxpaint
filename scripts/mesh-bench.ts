#!/usr/bin/env npx tsx
/**
 * Mesh optimization baseline benchmark.
 *
 * Usage: npx tsx scripts/mesh-bench.ts [--merge | --no-merge | --both]
 * Defaults to --both: times each corpus case with the coplanar merge on and off.
 * Each line times the CSG path and, when eligible, the shell fast path.
 *
 * This is a harness, not a test: it never runs under `npm test`.
 */

import { DEFAULT_PALETTE } from '../src/engine/palette/defaultPalette.ts'
import { buildOptimizedVoxelGroups, buildOptimizedVoxelGroupsShell } from '../src/engine/instancing/voxelMeshBuilder.ts'
import { unwrapGeometries } from '../src/engine/ao/uvUnwrap.ts'
import { bakeAOToAtlas } from '../src/engine/ao/bakeAO.ts'
import { emptyModel, encodeKey, recomputeBounds } from '../src/engine/grid/GridStore.ts'
import { subdivideCell } from '../src/engine/grid/subdiv.ts'
import type { VoxelModel } from '../src/engine/grid/types.ts'
import type { PaletteSlotRef } from '../src/engine/palette/types.ts'
import { CORPUS } from '../src/engine/instancing/meshBenchCorpus.ts'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }

/** Surface shell of a `size`³ cube (hollow) — the realistic large-model shape. */
function hollowShell(size: number): VoxelModel {
  const model = emptyModel()
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++) {
        if (x > 0 && y > 0 && z > 0 && x < size - 1 && y < size - 1 && z < size - 1) continue
        model.color.set(encodeKey(x, y, z), { paletteSlot: base0 })
      }
  return { ...model, bounds: recomputeBounds(model) }
}

/** Solid cube — the worst case for the CSG union and the AO bake's outer faces. */
function solidCube(size: number): VoxelModel {
  const model = emptyModel()
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++) model.color.set(encodeKey(x, y, z), { paletteSlot: base0 })
  return { ...model, bounds: recomputeBounds(model) }
}

/** Full preview-pipeline timing: mesh build, UV unwrap, AO bake (as `OptimizedMeshView` does). */
function benchPipeline(label: string, model: VoxelModel, voxels: number, merge: boolean, ao: boolean) {
  const t0 = performance.now()
  const built = buildOptimizedVoxelGroupsShell(model, DEFAULT_PALETTE, merge)
    ?? buildOptimizedVoxelGroups(model, DEFAULT_PALETTE, merge)
  const meshMs = performance.now() - t0
  const geoms = built.groups.map((g) => g.geometry)

  const t1 = performance.now()
  const { atlas } = unwrapGeometries(geoms)
  const unwrapMs = performance.now() - t1

  let aoMs = -1
  if (ao) {
    const t2 = performance.now()
    bakeAOToAtlas(model, atlas, 0, 1)
    aoMs = performance.now() - t2
  }
  const tris = built.groups.reduce((n, g) => {
    const pos = g.geometry.getAttribute('position')
    return n + (pos ? pos.count / 3 : 0)
  }, 0)
  console.log(`${label}\tvox=${voxels}\ttris=${tris}\tmesh=${meshMs.toFixed(1)}\tunwrap=${unwrapMs.toFixed(1)}\tao=${aoMs < 0 ? 'off' : aoMs.toFixed(1)}`)
  for (const g of built.groups) g.geometry.dispose()
}

const mode = process.argv[2] ?? '--both'
const mergeSettings = mode === '--merge' ? [true] : mode === '--no-merge' ? [false] : [false, true]

for (const merge of mergeSettings) {
  console.log(`\n== mergeCoplanar=${merge} ==`)
  console.log('case\tvoxels\tcsg-ms\tcsg-opt\tshell-ms\tshell-opt')
  for (const { name, voxels, build } of CORPUS) {
    const model = build()
    const t0 = performance.now()
    const csg = buildOptimizedVoxelGroups(model, DEFAULT_PALETTE, merge)
    const csgMs = performance.now() - t0
    const t1 = performance.now()
    const shell = buildOptimizedVoxelGroupsShell(model, DEFAULT_PALETTE, merge)
    const shellMs = performance.now() - t1
    const shellStr = shell ? `${shellMs.toFixed(1)}\t${shell.optimizedTriangles}` : 'n/a (CSG fallback)'
    console.log(`${name}\t${voxels}\t${csgMs.toFixed(1)}\t${csg.optimizedTriangles}\t${shellStr}`)
    for (const g of csg.groups) g.geometry.dispose()
    if (shell) for (const g of shell.groups) g.geometry.dispose()
  }
}

console.log('\n== full preview pipeline (merge=true, shell-or-fallback) ==')
console.log('case\tvox\ttris\tmesh\tunwrap\tao')
{
  const shell16 = hollowShell(16)
  benchPipeline('hollow-16³', shell16, 16 ** 3 - 14 ** 3, true, false)
  benchPipeline('hollow-16³+AO', shell16, 16 ** 3 - 14 ** 3, true, true)
  const shell12 = hollowShell(12)
  benchPipeline('hollow-12³', shell12, 12 ** 3 - 10 ** 3, true, false)
  const solid16 = solidCube(16)
  benchPipeline('solid-16³+AO', solid16, 16 ** 3, true, true)
  // Detail patch: solid 8³ with a subdivided face block + AO — the new mixed-seam path.
  const detailed = solidCube(8)
  for (let x = 0; x < 4; x++)
    for (let z = 0; z < 4; z++) subdivideCell(detailed, [x, 7, z])
  detailed.bounds = recomputeBounds(detailed)
  benchPipeline('solid-8³+detail+AO', detailed, 8 ** 3, true, true)
  // Mixed splits: u/halves plus quarters on solid 8³ — exercises variable-size seams.
  const mixed = solidCube(8)
  for (let x = 0; x < 4; x++)
    for (let z = 0; z < 4; z++) subdivideCell(mixed, [x, 7, z], (x + z) % 2 === 0 ? ['x'] : ['x', 'y'])
  mixed.bounds = recomputeBounds(mixed)
  benchPipeline('solid-8³+mixed+AO', mixed, 8 ** 3, true, true)
}
