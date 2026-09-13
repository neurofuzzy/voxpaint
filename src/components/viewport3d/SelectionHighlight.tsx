import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildSelectionHighlightBatches } from '@/engine/instancing/ghostBatches'
import { useAppStore } from '@/store/useAppStore'
import { useGhostGroup } from './useGhostGroup'

/** Matches the 2D canvas's selection tint and marching ants (PixelCanvas.tsx). */
const SELECTION_CYAN = 0x22d3ee
const CAST_OPACITY = 0.35

/**
 * Casts the 2D canvas's selection cyan over the actual voxels inside a (non-floating) selection,
 * so the 3D view shows which voxels a delete or transform is about to hit. Without it the
 * selection is a purely 2D concept and 3D gives no feedback at all.
 *
 * Skipped while content is floating — `FloatGhostPreview` already draws the float in full, and the
 * selection rectangle then just tracks it, so casting as well would double up on the same cells.
 *
 * This is an overlay rather than a real tint because the visible model is CSG-merged and grouped by
 * (materialClass, color) — see OptimizedMeshView — so there is no per-voxel color to modulate. The
 * overlay geometry is exactly coincident with the model surface, hence the polygon offset.
 */
export function SelectionHighlight() {
  const selection = useAppStore((s) => s.selection)
  const floatContent = useAppStore((s) => s.floatContent)
  const model = useAppStore((s) => s.model)
  const plane = useAppStore((s) => s.plane)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  // A selection made in Model mode survives a mode switch; only Model mode acts on it.
  const isModelMode = useAppStore((s) => s.mode === 'model')

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SELECTION_CYAN,
        transparent: true,
        opacity: CAST_OPACITY,
        // Coincident with the model's own surface, so pull it toward the camera to win the depth
        // test outright instead of z-fighting. depthWrite stays off so it never occludes anything.
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  const batches = useMemo(
    () => (floatContent || !isModelMode ? [] : buildSelectionHighlightBatches(model, plane, selection, gridExtent)),
    [model, plane, selection, gridExtent, floatContent, isModelMode],
  )

  const group = useGhostGroup(batches, material)
  return <primitive object={group} />
}
