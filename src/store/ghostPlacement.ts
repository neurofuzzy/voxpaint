import * as THREE from 'three'
import { encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Axis, Coord, GridExtent, Orientation, Rotation } from '@/engine/grid/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { chamferBasisIsReflected, chamferInstanceMatrix, scaledChamferInstanceMatrix } from '@/engine/instancing/basis'
import type { PoolId } from '@/engine/instancing/pools'
import type { SplitAxis, VoxelModel } from '@/engine/grid/types'
import { sampleBoxNeighborhood } from '@/engine/grid/subdiv'
import { bevelFitsBox, boxWorld, gridBox, isWholeBox } from '@/engine/grid/cellBox'
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
  /** The armed grid division (the box a paint tap writes — see `gridBox`). */
  gridSplit?: SplitAxis[] | null
  /** World half-bits of the pointer inside the hovered cell (in-plane axes; the plane's slab
   * decides depth), from whichever view the pointer is in. Null spans the in-plane extent. */
  hoverBits?: Coord | null
}

export type GhostPlacement =
  | { kind: 'cube'; target: Coord; box?: { origin: Coord; size: Coord } }
  | { kind: 'chamfer'; target: Coord; axis: Axis; orientation: Orientation; pool: PoolId; matrix: THREE.Matrix4; flat: boolean }

/**
 * Shared 3D-direct paint target: the single source of truth for what a paint tap writes.
 * Used by `resolveGhostPlacement` (preview) and `applyBlockingTap` in Viewport3D.tsx (the
 * write) so the two can never disagree.
 *
 * Paint is replace-only on the construction plane (2D parity): a face hit replaces the
 * hovered voxel itself when it sits on the active slice; an off-slice face hit projects
 * onto the plane (same in-plane column at the plane offset) instead of stacking. Occupied
 * cells are always allowed (replaced, never blocked). Empty-space hovers paint the
 * construction-plane cell under the cursor.
 *
 * Returns the target coord, or null when the tap paints nothing (out of bounds).
 */
export function resolveDirectPaintTarget(
  plane: ConstructionPlane,
  hoverCell: Coord | null,
  hoveredFace: HoveredFace | null,
  gridExtent: GridExtent,
): Coord | null {
  const faceHit =
    hoverCell && hoveredFace && hoveredFace.cellKey === encodeKey(...hoverCell)
  if (faceHit && hoverCell) {
    // Constrained to the active slice: on-slice hover replaces itself; off-slice hover
    // projects onto the plane rather than stacking across the face.
    const target: Coord = [...hoverCell] as Coord
    target[axisIndex(plane.axis)] = plane.offset
    if (!withinWorkingBounds(target, gridExtent)) return null
    return target
  }
  if (!hoverCell) return null
  if (!withinWorkingBounds(hoverCell, gridExtent)) return null
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
 * comes from `resolveDirectPaintTarget` (replace-only on the construction plane —
 * on-slice face hits replace the hovered voxel, off-slice face hits project onto the
 * plane; face must belong to the hovered cell, 2D hover sets `hoverCell` without a
 * face), but orientation ALWAYS inherits
 * the active construction plane, never the raycast face — matching the paint write (see
 * `applyBlockingTap`); otherwise (split layout, or non-direct paint) the hover cell itself in
 * the active plane's frame. Hidden when
 * blocked (out of bounds). Non-paint tools in split layout
 * get the legacy cube. `ramp`/`wedge` sample live
 * autotile neighbors (2D and 3D alike — the preview is exactly the paint write, see
 * `applyPaintCell`); every other kind resolves from the brush alone (explicit corners
 * never autotile).
 */
export function resolveGhostPlacement(input: GhostPlacementInput): GhostPlacement | null {
  const { model, plane, hoverCell, hoveredFace, activeVoxelKind, brushRotation, activeTool, directEdit, gridExtent, gridSplit, hoverBits } = input
  // Direct-manipulation 3D (3D-only layout) shows a ghost only for tools that place something
  // at the hover cell — paint, plus marker (which drops a marker there). Material recolors on
  // hover-blink; select/wand show their own overlays; erase/eyedropper/fill act on
  // existing voxels or whole regions, so a place-here cube would promise a paint that never comes.
  if (directEdit && activeTool !== 'paint' && activeTool !== 'marker') return null
  let target: Coord | null = null
  if (directEdit && activeTool === 'paint') {
    // 3D-direct paint (both face hits and empty-space hovers) resolves through the shared
    // helper so preview and write agree (replace-only on the construction plane).
    target = resolveDirectPaintTarget(plane, hoverCell, hoveredFace, gridExtent)
    if (!target) return null
  } else {
    if (!hoverCell) return null
    // No ghost on occupied voxels in split layout: the 2D canvas's gold footprint carries the
    // feedback there, and marker drops only on empty space.
    if (model.color.has(encodeKey(...hoverCell))) return null
    if (!withinWorkingBounds(hoverCell, gridExtent)) return null
    target = hoverCell
  }

  if (activeTool !== 'paint') return { kind: 'cube', target }

  // Orientation ALWAYS inherits the active construction plane — never the raycast face — so the
  // preview matches the paint write (see `applyBlockingTap` in Viewport3D.tsx).
  const faceAxis = plane.axis
  const faceOrientation = plane.orientation
  const box = gridBox(plane, gridSplit ?? null, hoverBits ?? null)

  if (!isWholeBox(box)) {
    // Sub-voxel paint: exactly the box `paintBox` writes — a scaled bevel when the target can
    // hold one as a single child (`bevelFitsBox`), else the box itself.
    const { origin, size } = boxWorld(target, box)
    const cubeGhost: GhostPlacement = { kind: 'cube', target, box: { origin: origin as Coord, size: size as Coord } }
    if (activeVoxelKind === 'cube' || !bevelFitsBox(model, target, box)) return cubeGhost
    const auto = activeVoxelKind === 'ramp' || activeVoxelKind === 'wedge'
      ? classify(sampleBoxNeighborhood(model, plane, target, box))
      : null
    const shape = resolveBrushPreview(activeVoxelKind, brushRotation, auto)
    if (!shape) return cubeGhost
    return {
      kind: 'chamfer',
      target,
      axis: faceAxis,
      orientation: faceOrientation,
      pool: chamferBasisIsReflected(faceAxis, faceOrientation) ? (`${shape.shapeKind}M` as PoolId) : shape.shapeKind,
      matrix: scaledChamferInstanceMatrix(origin, size, faceAxis, faceOrientation, shape.rotation),
      flat: shape.shapeKind === 'flat' || shape.shapeKind === 'flatwedge',
    }
  }

  const facePlane: ConstructionPlane = { axis: faceAxis, orientation: faceOrientation, offset: target[axisIndex(faceAxis)], half: null }
  const { u, v } = pixelFromGridCoord(facePlane, target)
  const auto = (activeVoxelKind === 'ramp' || activeVoxelKind === 'wedge')
    ? classify(sampleNeighbors(model, facePlane, u, v))
    : null
  const shape = resolveBrushPreview(activeVoxelKind, brushRotation, auto)
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
