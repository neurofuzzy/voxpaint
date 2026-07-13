import * as THREE from 'three'
import ThreeBSP from '@/engine/csg/ThreeCSG'
import type { MaterialClass } from '@/engine/palette/palette'

/**
 * CSG-based mesh optimizer. Groups per-voxel closed (watertight) solid geometries by
 * (materialClass, colorKey), then binary-tree-unions each group through ThreeBSP. The CSG
 * boolean union naturally discards interior faces between adjacent same-colour voxels while
 * preserving disconnected components without accidental edge-sharing bridges.
 *
 * Because colour separation happens *before* unioning, adjacent voxels of different colours
 * keep their shared interface faces. Each result group carries a single `colorKey` and
 * `materialClass` — the consumer creates one solid-colour material (no vertex colors needed).
 */

export interface VoxelGroup {
  colorKey: number
  materialClass: MaterialClass
  geometries: THREE.BufferGeometry[]
}

export interface ColorGroupGeometry {
  colorKey: number
  materialClass: MaterialClass
  geometry: THREE.BufferGeometry
}

/** Triangle count of a (non-indexed or indexed) geometry. */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex()
  if (index) return index.count / 3
  const pos = geometry.getAttribute('position')
  return pos ? pos.count / 3 : 0
}

/** Binary-tree reduction of many BSP trees into one via pairwise union. */
function unionAll(bsps: ThreeBSP[]): ThreeBSP | null {
  if (bsps.length === 0) return null
  let work = bsps
  while (work.length > 1) {
    const next: ThreeBSP[] = []
    for (let i = 0; i < work.length; i += 2) {
      if (i + 1 < work.length) {
        next.push(work[i].union(work[i + 1]))
      } else {
        next.push(work[i])
      }
    }
    work = next
  }
  return work[0]
}

/**
 * For each `VoxelGroup`, transform every solid geometry into a ThreeBSP tree, binary-tree-union
 * them into a single watertight surface, and convert the result back to BufferGeometry. Each
 * output entry carries the group's `colorKey` and `materialClass` — the caller applies a solid-
 * colour material (no vertex colors).
 */
export function optimizeGroupsByCSG(groups: VoxelGroup[]): ColorGroupGeometry[] {
  const results: ColorGroupGeometry[] = []

  for (const group of groups) {
    if (group.geometries.length === 0) continue

    const bsps: ThreeBSP[] = []
    for (const geom of group.geometries) {
      bsps.push(new ThreeBSP(geom))
    }

    const merged = unionAll(bsps)
    if (merged) {
      results.push({
        colorKey: group.colorKey,
        materialClass: group.materialClass,
        geometry: merged.toGeometry(),
      })
    }
  }

  return results
}
