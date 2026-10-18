import * as THREE from 'three'
import { encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Axis, Coord, GridExtent, Orientation, Rotation } from '@/engine/grid/types'
import { outwardNormal, axisIndex } from '@/engine/plane/planeGeometry'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { chamferBasisIsReflected, chamferInstanceMatrix } from '@/engine/instancing/basis'
import type { PoolId } from '@/engine/instancing/pools'
import type { VoxelModel } from '@/engine/grid/types'
import { resolveBrushPreview } from './brushPreview'
import type { HoveredFace, ToolId, VoxelKind } from './types'

export type GhostPlacementInput = {
  model: VoxelModel
  plane: ConstructionPlane
  hoverCell: Coord | null
  hoveredFace: HoveredFace | null
  activeVoxelKind: VoxelKind
  brushRotation: Rotation
  activeTool: ToolId
  edit3D: boolean
  gridExtent: GridExtent
  layoutMode: 'split' | '3d-only'
}

export type GhostPlacement =
  | { kind: 'cube'; target: Coord }
  | { kind: 'chamfer'; target: Coord; axis: Axis; orientation: Orientation; pool: PoolId; matrix: THREE.Matrix4; flat: boolean }

/**
 * Shared placement resolution for the in-scene ghost (`VoxelGhostPreview`), the HUD brush
 * preview (`BrushPreview`), and — by contract — what `applyPaintCell` writes. One function so
 * the three can never disagree about basis, reflection, or autotile context.
 *
 * Rules (kept verbatim from the original ghost memo): hidden for the material tool and for
 * the select tool in 3D Edit mode (no paint preview while selecting); in 3D Edit
 * with paint, the placement cell is the neighbor across the hovered face (face must belong to
 * the hovered cell — 2D hover sets `hoverCell` without a face), but orientation ALWAYS inherits
 * the active construction plane, never the raycast face — matching the paint write (see
 * `applyBlockingTap`); otherwise the hover cell itself in the active plane's frame. Hidden when
 * occupied/out of bounds. Non-paint tools get the legacy cube. `ramp`/`wedge` sample live
 * autotile neighbors, except in 3D-only mode, which is
 * verbatim (no classification — the preview is exactly the paint write, see `applyPaintCell`);
 * every other kind resolves from the brush alone (explicit corners never autotile).
 */
export function resolveGhostPlacement(input: GhostPlacementInput): GhostPlacement | null {
  const { model, plane, hoverCell, hoveredFace, activeVoxelKind, brushRotation, activeTool, edit3D, gridExtent, layoutMode } = input
  const verbatim = layoutMode === '3d-only'
  // Material recolors on hover-blink alone; select shows no paint preview (the marquee overlay
  // and cyan selection cast cover feedback instead, like the 2D canvas while selecting).
  if (edit3D && (activeTool === 'material' || activeTool === 'select')) return null
  let target: Coord | null = null
  let faceAxis: Axis | null = null
  let faceOrientation: Orientation | null = null
  if (edit3D && activeTool === 'paint' && hoverCell && hoveredFace && hoveredFace.cellKey === encodeKey(...hoverCell)) {
    const normal = outwardNormal(hoveredFace.axis, hoveredFace.orientation)
    const t: Coord = [hoverCell[0] + normal[0], hoverCell[1] + normal[1], hoverCell[2] + normal[2]]
    if (!withinWorkingBounds(t, gridExtent)) return null
    if (model.color.has(encodeKey(...t))) return null
    target = t
    // Orientation inherits the active construction plane — never the raycast face — so the
    // preview matches the paint write (see `applyBlockingTap` in Viewport3D.tsx).
    faceAxis = plane.axis
    faceOrientation = plane.orientation
  } else {
    if (!hoverCell) return null
    if (model.color.has(encodeKey(...hoverCell))) return null
    if (!withinWorkingBounds(hoverCell, gridExtent)) return null
    target = hoverCell
    faceAxis = plane.axis
    faceOrientation = plane.orientation
  }

  if (activeTool !== 'paint') return { kind: 'cube', target }

  const facePlane: ConstructionPlane = { axis: faceAxis, orientation: faceOrientation, offset: target[axisIndex(faceAxis)] }
  const { u, v } = pixelFromGridCoord(facePlane, target)
  const auto = !verbatim && (activeVoxelKind === 'ramp' || activeVoxelKind === 'wedge')
    ? classify(sampleNeighbors(model, facePlane, u, v))
    : null
  const shape = verbatim && activeVoxelKind === 'ramp'
    ? { shapeKind: 'ramp' as const, rotation: brushRotation }
    : resolveBrushPreview(activeVoxelKind, brushRotation, auto)
  if (!shape) return { kind: 'cube', target }
  const pool: PoolId = chamferBasisIsReflected(faceAxis, faceOrientation)
    ? (`${shape.shapeKind}M` as PoolId)
    : shape.shapeKind
  const matrix = chamferInstanceMatrix(target, faceAxis, faceOrientation, shape.rotation)
  return {
    kind: 'chamfer',
    target,
    axis: faceAxis,
    orientation: faceOrientation,
    pool,
    matrix: matrix.clone(),
    flat: shape.shapeKind === 'flat' || shape.shapeKind === 'flatwedge',
  }
}
