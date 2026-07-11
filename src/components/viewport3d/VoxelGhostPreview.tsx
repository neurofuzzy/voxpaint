import { useMemo } from 'react'
import { encodeKey } from '@/engine/grid/GridStore'
import { resolveSlotColor } from '@/engine/palette/palette'
import { useAppStore } from '@/store/useAppStore'

/**
 * Semi-transparent placeholder cube at the hovered grid cell (`hoverCell` — driven by both 3D
 * self-hover and 2D-canvas hover, see usePixelCanvasTools.ts) when nothing is painted there yet,
 * tinted with the active palette color as a preview of what a paint click would place. When a
 * voxel already exists there, InstancingManager's own hover blink handles the feedback instead —
 * this component just stays hidden (checked via `model.color`, the same source of truth).
 */
export function VoxelGhostPreview() {
  const hoverCell = useAppStore((s) => s.hoverCell)
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const activePaletteSlot = useAppStore((s) => s.activePaletteSlot)

  const position = useMemo<[number, number, number] | null>(() => {
    if (!hoverCell) return null
    if (model.color.has(encodeKey(...hoverCell))) return null
    return [hoverCell[0] + 0.5, hoverCell[1] + 0.5, hoverCell[2] + 0.5]
  }, [hoverCell, model])

  if (!position) return null

  return (
    <mesh position={position} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={resolveSlotColor(palette, activePaletteSlot)} transparent opacity={0.32} depthWrite={false} />
    </mesh>
  )
}
