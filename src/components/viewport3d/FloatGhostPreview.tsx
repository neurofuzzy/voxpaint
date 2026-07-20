import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildFloatGhostBatches } from '@/engine/instancing/floatGhost'
import { buildPoolGeometries } from '@/engine/instancing/pools'
import { useAppStore } from '@/store/useAppStore'

const GHOST_OPACITY = 0.45

/**
 * Semi-transparent 3D preview of the floating selection at its current position.
 *
 * A lift or paste pulls its cells *out* of the model (`liftSelectionToFloat` clears the source
 * region), so without this the 3D view shows a hole and no sign of what's being dragged — the
 * float only existed on the 2D canvas. This renders it back in ghost form, following the float as
 * it moves, rotates and mirrors, and vanishing when `bakeFloatIfAny` writes it into the model for
 * real.
 *
 * Built imperatively into a `THREE.Group` (like `VoxelInstancedMeshes`) rather than as R3F JSX:
 * an `InstancedMesh`'s buffers are fixed-size at construction, so every change of cell count would
 * otherwise need a remount anyway. Layout comes from `buildFloatGhostBatches`.
 */
export function FloatGhostPreview() {
  const floatContent = useAppStore((s) => s.floatContent)
  const floatOrigin = useAppStore((s) => s.floatOrigin)
  const plane = useAppStore((s) => s.plane)
  const palette = useAppStore((s) => s.palette)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)

  const group = useMemo(() => new THREE.Group(), [])
  // Geometries and the shared material are owned per-mount (three.js disposal is by-instance) and
  // never change, so they're built once and released on unmount.
  const geometries = useMemo(() => buildPoolGeometries(), [])
  const material = useMemo(
    // Unlit, so the ghost reads as an overlay rather than a real surface competing with the model's
    // shading. depthWrite off keeps overlapping ghost cells from punching holes in each other.
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: GHOST_OPACITY, depthWrite: false }),
    [],
  )

  useEffect(() => {
    return () => {
      Object.values(geometries).forEach((g) => g.dispose())
      material.dispose()
    }
  }, [geometries, material])

  const batches = useMemo(
    () => buildFloatGhostBatches(floatContent, floatOrigin, plane, palette, gridExtent),
    [floatContent, floatOrigin, plane, palette, gridExtent],
  )

  useEffect(() => {
    // Rebuild from scratch on every float change — a float is at most one plane slice, and it only
    // changes on discrete edits (move/rotate/mirror), never per frame.
    for (const child of group.children) (child as THREE.InstancedMesh).dispose()
    group.clear()

    for (const { poolId, matrices, colors } of batches) {
      const mesh = new THREE.InstancedMesh(geometries[poolId], material, matrices.length)
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
      colors.forEach((c, i) => mesh.setColorAt(i, c))
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // Ghosts are display-only; picking must keep hitting the real model underneath.
      mesh.raycast = () => {}
      group.add(mesh)
    }
  }, [group, geometries, material, batches])

  return <primitive object={group} />
}
