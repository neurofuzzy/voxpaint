import { useMemo } from 'react'
import { encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import { outwardNormal } from '@/engine/plane/planeGeometry'
import { resolveSlotColor } from '@/engine/palette/palette'
import { useAppStore } from '@/store/useAppStore'

/**
 * Semi-transparent placeholder cube at the hovered grid cell (`hoverCell` — driven by both 3D
 * self-hover and 2D-canvas hover, see usePixelCanvasTools.ts) when nothing is painted there yet,
 * tinted with the active palette color as a preview of what a paint click would place. When a
 * voxel already exists there, InstancingManager's own hover blink handles the feedback instead —
 * this component just stays hidden (checked via `model.color`, the same source of truth).
 *
 * In 3D Edit mode with the paint tool, the ghost instead marks the *placement* cell across the
 * hovered face (the neighbor a click would paint into) — hidden when that cell is occupied or
 * out of bounds, where a click would repaint/reject. Hidden entirely for the material tool:
 * occupied cells already blink on hover and empty cells ignore it.
 */
export function VoxelGhostPreview() {
  const hoverCell = useAppStore((s) => s.hoverCell)
  const hoveredFace = useAppStore((s) => s.hoveredFace)
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const activePaletteSlot = useAppStore((s) => s.activePaletteSlot)
  const activeTool = useAppStore((s) => s.activeTool)
  const edit3D = useAppStore((s) => s.edit3D)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)

  const position = useMemo<[number, number, number] | null>(() => {
    if (edit3D && activeTool === 'material') return null
    // The face must belong to the hovered cell — 2D-canvas hover sets `hoverCell` without a face,
    // which must not pair with a stale 3D face from an earlier hover.
    if (edit3D && activeTool === 'paint' && hoverCell && hoveredFace && hoveredFace.cellKey === encodeKey(...hoverCell)) {
      const normal = outwardNormal(hoveredFace.axis, hoveredFace.orientation)
      const target: [number, number, number] = [hoverCell[0] + normal[0], hoverCell[1] + normal[1], hoverCell[2] + normal[2]]
      if (!withinWorkingBounds(target, gridExtent)) return null
      if (model.color.has(encodeKey(...target))) return null
      return [target[0] + 0.5, target[1] + 0.5, target[2] + 0.5]
    }
    if (!hoverCell) return null
    if (model.color.has(encodeKey(...hoverCell))) return null
    return [hoverCell[0] + 0.5, hoverCell[1] + 0.5, hoverCell[2] + 0.5]
  }, [hoverCell, hoveredFace, model, edit3D, activeTool, gridExtent])

  if (!position) return null

  return (
    <mesh position={position} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={resolveSlotColor(palette, activePaletteSlot)} transparent opacity={0.32} depthWrite={false} />
    </mesh>
  )
}
