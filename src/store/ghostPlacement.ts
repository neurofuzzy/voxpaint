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
  /** Direct-manipulation 3D (3D-only layout): taps apply tools on voxel faces. Callers pass
   * `layoutMode === '3d-only'` — split layout is orbit/navigate only, so this is false there. */
  directEdit: boolean
  gridExtent: GridExtent
  layoutMode: 'split' | '3d-only'
  /** 3D paint plane lock: when true, a paint tap replaces the hovered voxel on the active
   * slice instead of stacking the neighbor across the face. Defaults to false (unlocked,
   * Zanpo-builder behavior) so existing callers keep their contract. */
  planeLocked3D?: boolean
}

export type GhostPlacement =
  | { kind: 'cube'; target: Coord }
  | { kind: 'chamfer'; target: Coord; axis: Axis; orientation: Orientation; pool: PoolId; matrix: THREE.Matrix4; flat: boolean }

/**
 * Shared 3D-direct paint target: the single source of truth for what a paint tap writes.
 * Used by `resolveGhostPlacement` (preview) and `applyBlockingTap` in Viewport3D.tsx (the
 * write) so the two can never disagree.
 *
 * - Unlocked (Zanpo-builder behavior): a face hit places the neighbor across that face;
 *   occupied/out-of-bounds neighbors are blocked (null). Empty-space hovers paint the
 *   construction-plane cell under the cursor (blocked when occupied, matching the ghost).
 * - Locked: painting is constrained to the construction plane — a face hit replaces the
 *   hovered voxel itself, and only when it sits on the active slice (off-slice hits are
 *   blocked); occupied cells are allowed (replaced, never stacked). Empty-space hovers paint
 *   the plane cell, occupied or not.
 *
 * Returns the target coord, or null when the tap paints nothing.
 */
export function resolveDirectPaintTarget(
  model: VoxelModel,
  plane: ConstructionPlane,
  hoverCell: Coord | null,
  hoveredFace: HoveredFace | null,
  gridExtent: GridExtent,
  planeLocked3D: boolean,
): Coord | null {
  const faceHit =
    hoverCell && hoveredFace && hoveredFace.cellKey === encodeKey(...hoverCell)
  if (faceHit && hoverCell) {
    if (planeLocked3D) {
      // Constrained to the active slice: only the hovered voxel itself, only when it is on
      // the plane. Existing voxels are replaced (occupancy is fine).
      if (hoverCell[axisIndex(plane.axis)] !== plane.offset) return null
      if (!withinWorkingBounds(hoverCell, gridExtent)) return null
      return hoverCell
    }
    const normal = outwardNormal(hoveredFace.axis, hoveredFace.orientation)
    const t: Coord = [hoverCell[0] + normal[0], hoverCell[1] + normal[1], hoverCell[2] + normal[2]]
    if (!withinWorkingBounds(t, gridExtent)) return null
    if (model.color.has(encodeKey(...t))) return null
    return t
  }
  if (!hoverCell) return null
  if (!withinWorkingBounds(hoverCell, gridExtent)) return null
  // Empty-space hovers sit on the plane by construction (see `resolveEmptyCell`): locked
  // replaces whatever is there, unlocked keeps the legacy blocked-when-occupied rule.
  if (!planeLocked3D && model.color.has(encodeKey(...hoverCell))) return null
  return hoverCell
}

/**
 * Shared placement resolution for the in-scene ghost (`VoxelGhostPreview`), the HUD brush
 * preview (`BrushPreview`), and — by contract — what `applyPaintCell` writes. One function so
 * the three can never disagree about basis, reflection, or autotile context.
 *
 * Rules (kept verbatim from the original ghost memo): hidden for every direct-manipulation 3D
 * tool (3D-only layout) except paint and marker — erase/eyedropper/wand/fill/move/material/
 * select act on existing voxels or whole regions, never a place-here cube (marker drops a new
 * marker on the hover cell, so its cube preview stays); with paint, the placement cell
 * comes from `resolveDirectPaintTarget`
 * (unlocked: the neighbor across the hovered face — face must belong to the hovered cell —
 * 2D hover sets `hoverCell` without a face; locked: the hovered voxel itself on the active
 * slice, replacing it), but orientation ALWAYS inherits
 * the active construction plane, never the raycast face — matching the paint write (see
 * `applyBlockingTap`); otherwise (split layout, or non-direct paint) the hover cell itself in
 * the active plane's frame. Hidden when
 * blocked (occupied-unlocked/out of bounds/off-slice-locked). Non-paint tools in split layout
 * get the legacy cube. `ramp`/`wedge` sample live
 * autotile neighbors, except in 3D-only mode, which is
 * verbatim (no classification — the preview is exactly the paint write, see `applyPaintCell`);
 * every other kind resolves from the brush alone (explicit corners never autotile).
 */
export function resolveGhostPlacement(input: GhostPlacementInput): GhostPlacement | null {
  const { model, plane, hoverCell, hoveredFace, activeVoxelKind, brushRotation, activeTool, directEdit, gridExtent, layoutMode, planeLocked3D = false } = input
  const verbatim = layoutMode === '3d-only'
  // Direct-manipulation 3D (3D-only layout) shows a ghost only for tools that place something
  // at the hover cell — paint, plus marker (which drops a marker there). Material recolors on
  // hover-blink; select/wand show their own overlays; erase/eyedropper/fill/move act on
  // existing voxels or whole regions, so a place-here cube would promise a paint that never
  // comes.
  if (directEdit && activeTool !== 'paint' && activeTool !== 'marker') return null
  let target: Coord | null = null
  let faceAxis: Axis | null = null
  let faceOrientation: Orientation | null = null
  if (directEdit && activeTool === 'paint') {
    // 3D-direct paint (both face hits and empty-space hovers) resolves through the shared
    // helper so preview and write agree — including the plane lock (replace on-slice vs.
    // stack-across-the-face).
    const t = resolveDirectPaintTarget(model, plane, hoverCell, hoveredFace, gridExtent, planeLocked3D)
    if (!t) return null
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
