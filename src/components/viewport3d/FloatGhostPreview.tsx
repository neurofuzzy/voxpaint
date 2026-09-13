import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildFloatGhostBatches } from '@/engine/instancing/ghostBatches'
import { useAppStore } from '@/store/useAppStore'
import { useGhostGroup } from './useGhostGroup'

const GHOST_OPACITY = 0.45

/**
 * Semi-transparent 3D preview of the floating selection at its current position.
 *
 * A lift or paste pulls its cells *out* of the model (`liftSelectionToFloat` clears the source
 * region), so without this the 3D view shows a hole and no sign of what's being dragged — the
 * float only existed on the 2D canvas. This renders it back in ghost form, following the float as
 * it moves, rotates and mirrors, and vanishing when `bakeFloatIfAny` writes it into the model for
 * real. Cells keep their own palette colors, so you can see *what* you're dragging.
 */
export function FloatGhostPreview() {
  const floatContent = useAppStore((s) => s.floatContent)
  const floatOrigin = useAppStore((s) => s.floatOrigin)
  const plane = useAppStore((s) => s.plane)
  const palette = useAppStore((s) => s.palette)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)

  const material = useMemo(
    // Unlit, so the ghost reads as an overlay rather than a real surface competing with the model's
    // shading. depthWrite off keeps overlapping ghost cells from punching holes in each other.
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: GHOST_OPACITY, depthWrite: false }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  const batches = useMemo(
    () => buildFloatGhostBatches(floatContent, floatOrigin, plane, palette, gridExtent),
    [floatContent, floatOrigin, plane, palette, gridExtent],
  )

  const group = useGhostGroup(batches, material)
  return <primitive object={group} />
}
