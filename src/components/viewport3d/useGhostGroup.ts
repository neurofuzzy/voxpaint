import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { GhostBatch } from '@/engine/instancing/ghostBatches'
import { buildPoolGeometries } from '@/engine/instancing/pools'

/**
 * Renders a set of `GhostBatch`es into a `THREE.Group` of `InstancedMesh`es — the shared machinery
 * behind the floating-selection ghost and the selection cast.
 *
 * Built imperatively (like `VoxelInstancedMeshes`) rather than as R3F JSX: an `InstancedMesh`'s
 * buffers are fixed-size at construction, so every change in cell count would need a remount
 * anyway. Geometries are owned per-hook-instance because three.js disposal is by-instance; the
 * caller owns `material` and must memoize it, since a new material each render would rebuild
 * every mesh.
 */
export function useGhostGroup(batches: GhostBatch[], material: THREE.Material): THREE.Group {
  const group = useMemo(() => new THREE.Group(), [])
  const geometries = useMemo(() => buildPoolGeometries(), [])

  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries])

  useEffect(() => {
    // Rebuild from scratch on every change — an overlay is at most one plane slice, and it only
    // changes on discrete edits (move/rotate/mirror/reselect), never per frame.
    for (const child of group.children) (child as THREE.InstancedMesh).dispose()
    group.clear()

    for (const { poolId, matrices, colors } of batches) {
      const mesh = new THREE.InstancedMesh(geometries[poolId], material, matrices.length)
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
      colors?.forEach((c, i) => mesh.setColorAt(i, c))
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // Overlays are display-only; picking must keep hitting the real model underneath.
      mesh.raycast = () => {}
      group.add(mesh)
    }
  }, [group, geometries, material, batches])

  return group
}
