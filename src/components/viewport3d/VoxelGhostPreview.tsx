import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildPoolGeometries } from '@/engine/instancing/pools'
import { resolveSlotColor } from '@/engine/palette/palette'
import { resolveGhostPlacement } from '@/store/ghostPlacement'
import { useAppStore } from '@/store/useAppStore'

/**
 * Semi-transparent preview of what a paint click would place, at the hovered grid cell
 * (`hoverCell` — driven by both 3D self-hover and 2D-canvas hover, see usePixelCanvasTools.ts).
 * Tinted with the active palette color; renders the actual brush shape (chamfer prefab via the
 * same `chamferInstanceMatrix` placement real instances use), not just a cube. Falls back to the
 * plain cube when the brush is a cube, or when a ramp's autotile can't classify yet (an
 * unresolvable ramp paints as a cube — see `applyPaintCell`).
 *
 * Placement math lives in `store/ghostPlacement.ts` (shared with the HUD `BrushPreview`), so the
 * ghost, the HUD, and the paint write itself resolve basis, reflection, and autotile identically.
 *
 * When a voxel already exists at the hover cell, InstancingManager's own hover blink handles the
 * feedback instead — this component stays hidden (checked via `model.color`). It also stays
 * hidden for the select tool in 3D-only layout (see `resolveGhostPlacement`).
 */
export function VoxelGhostPreview() {
  const hoverCell = useAppStore((s) => s.hoverCell)
  const hoveredFace = useAppStore((s) => s.hoveredFace)
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const activePaletteSlot = useAppStore((s) => s.activePaletteSlot)
  const activeVoxelKind = useAppStore((s) => s.activeVoxelKind)
  const brushRotation = useAppStore((s) => s.brushRotation)
  const activeTool = useAppStore((s) => s.activeTool)
  const plane = useAppStore((s) => s.plane)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const pendingSplit = useAppStore((s) => s.pendingSplit)
  const hoverBits = useAppStore((s) => s.hoverBits)
  const hoverQuad = useAppStore((s) => s.hoverQuad)
  const layoutMode = useAppStore((s) => s.layoutMode)

  // One geometry set for the component's lifetime (callers own disposal).
  const pools = useMemo(() => buildPoolGeometries(), [])
  useEffect(() => () => {
    for (const g of Object.values(pools)) g.dispose()
  }, [pools])

  const ghost = useMemo(
    () => resolveGhostPlacement({ model, plane, hoverCell, hoveredFace, activeVoxelKind, brushRotation, activeTool, directEdit: layoutMode === '3d-only', gridExtent, pendingSplit, hoverBits, hoverQuad }),
    [model, plane, hoverCell, hoveredFace, activeVoxelKind, brushRotation, activeTool, gridExtent, layoutMode, pendingSplit, hoverBits, hoverQuad],
  )

  if (!ghost) return null
  const color = resolveSlotColor(palette, activePaletteSlot)

  if (ghost.kind === 'cube') {
    // With a grid armed the ghost is the child a tap would paint, not the whole voxel.
    const [ox, oy, oz] = ghost.box?.origin ?? ghost.target
    const [sx, sy, sz] = ghost.box?.size ?? [1, 1, 1]
    return (
      <mesh position={[ox + sx / 2, oy + sy / 2, oz + sz / 2]} raycast={() => null}>
        <boxGeometry args={[sx, sy, sz]} />
        <meshBasicMaterial color={color} transparent opacity={0.32} depthWrite={false} />
      </mesh>
    )
  }

  return (
    <mesh matrix={ghost.matrix} matrixAutoUpdate={false} raycast={() => null}>
      <primitive object={pools[ghost.pool]} attach="geometry" />
      <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} side={ghost.flat ? THREE.DoubleSide : THREE.FrontSide} />
    </mesh>
  )
}
