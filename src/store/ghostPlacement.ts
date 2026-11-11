import * as THREE from 'three'
import { encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Axis, Coord, GridExtent, Orientation, Rotation } from '@/engine/grid/types'
import { subdivDisplayBits } from '@/engine/tools/quadrant'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { chamferBasisIsReflected, chamferInstanceMatrix } from '@/engine/instancing/basis'
import type { PoolId } from '@/engine/instancing/pools'
import type { SplitAxis, VoxelModel } from '@/engine/grid/types'
import { frontSlabBit, splitChildIndex, splitChildOrigin, splitChildSize } from '@/engine/grid/subdiv'
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
  /** The armed grid division: on a half-voxel stop a tap on a plain cell splits it (so it ghosts). */
  pendingSplit?: SplitAxis[] | null
  /** Which half of the hovered cell the pointer is in along each world axis (the plane axis entry
   * is ignored: the plane's slab decides it). Null when unknown (2D hover) — the ghost then spans
   * the cell's full in-plane extent. */
  hoverBits?: Coord | null
  /** 2D hover: the display-space quadrant under the pointer. Wins over `hoverBits` when set (the two
   * hover sources clear each other, so whichever view the pointer is in is the live one). */
  hoverQuad?: [number, number] | null
}

export type GhostPlacement =
  | { kind: 'cube'; target: Coord; box?: { origin: Coord; size: Coord } }
  | { kind: 'chamfer'; target: Coord; axis: Axis; orientation: Orientation; pool: PoolId; matrix: THREE.Matrix4; flat: boolean }

/**
 * The child a tap would paint into a plain cell the armed grid is about to split: the slab on the
 * plane's axis (the explicit half-voxel stop, else the viewer-side slab) and the half the pointer
 * is over along the other cut axes (`hoverBits`; the full extent when unknown). One function for
 * the ghost AND the tap write, so they cannot disagree.
 */
export function armedChildBits(
  split: SplitAxis[],
  plane: ConstructionPlane,
  hoverBits: Coord | null | undefined,
): { index: number; bits: Coord } {
  const bits: Coord = hoverBits ? [...hoverBits] : [0, 0, 0]
  bits[axisIndex(plane.axis)] = plane.half ?? frontSlabBit(plane.orientation)
  return { index: splitChildIndex(split, bits[0], bits[1], bits[2]), bits }
}

/** The child index the armed grid addresses under the hover (2D quadrant wins over the 3D pointer
 * half); null when neither is known. */
export function armedHoverIndex(
  split: SplitAxis[],
  plane: ConstructionPlane,
  hoverBits: Coord | null | undefined,
  hoverQuad: [number, number] | null | undefined,
): number | null {
  const bits = hoverQuad ? subdivDisplayBits(plane, split, hoverQuad[0], hoverQuad[1]) : hoverBits
  return bits ? armedChildBits(split, plane, bits).index : null
}

function gridBox(target: Coord, split: SplitAxis[], plane: ConstructionPlane, hoverBits: Coord | null | undefined) {
  const { index } = armedChildBits(split, plane, hoverBits)
  const size = splitChildSize(split)
  const origin = splitChildOrigin(target, split, index)
  if (!hoverBits) {
    // Pointer half unknown: span the whole in-plane extent, keep only the plane-axis cut.
    for (const a of split) {
      if (a !== plane.axis) {
        size[axisIndex(a)] = 1
        origin[axisIndex(a)] = target[axisIndex(a)]
      }
    }
  }
  return { origin: origin as Coord, size: size as Coord }
}

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
  const { model, plane, hoverCell, hoveredFace, activeVoxelKind, brushRotation, activeTool, directEdit, gridExtent, pendingSplit, hoverBits, hoverQuad } = input
  // Direct-manipulation 3D (3D-only layout) shows a ghost only for tools that place something
  // at the hover cell — paint, plus marker (which drops a marker there). Material recolors on
  // hover-blink; select/wand show their own overlays; erase/eyedropper/fill act on
  // existing voxels or whole regions, so a place-here cube would promise a paint that never
  // comes. A paint tap on a plain cell with an armed grid splits it just-in-time, so paint
  // keeps its ghost everywhere.
  if (directEdit && activeTool !== 'paint' && activeTool !== 'marker') return null
  let target: Coord | null = null
  let faceAxis: Axis | null = null
  let faceOrientation: Orientation | null = null
  if (directEdit && activeTool === 'paint') {
    // 3D-direct paint (both face hits and empty-space hovers) resolves through the shared
    // helper so preview and write agree (replace-only on the construction plane).
    const t = resolveDirectPaintTarget(plane, hoverCell, hoveredFace, gridExtent)
    if (!t) return null
    target = t
    // Orientation inherits the active construction plane — never the raycast face — so the
    // preview matches the paint write (see `applyBlockingTap` in Viewport3D.tsx).
    faceAxis = plane.axis
    faceOrientation = plane.orientation
  } else {
    if (!hoverCell) return null
    // No ghost on occupied voxels: paint replaces whole voxels or paints the hovered
    // half-cell on subdivided parents (the octant hover blink + face highlight carry the
    // feedback there), and marker drops only on empty space.
    if (model.color.has(encodeKey(...hoverCell))) return null
    // Half-step admits subdivided voxels only — no place-here cube over plain cells,
    // where a tap would refuse (the write itself fails closed in applyPaintCell).
    if (plane.half !== null && !pendingSplit && !model.subdiv.has(encodeKey(...hoverCell))) return null
    if (!withinWorkingBounds(hoverCell, gridExtent)) return null
    target = hoverCell
    faceAxis = plane.axis
    faceOrientation = plane.orientation
  }

  if (activeTool !== 'paint') return { kind: 'cube', target }

  const facePlane: ConstructionPlane = { axis: faceAxis, orientation: faceOrientation, offset: target[axisIndex(faceAxis)], half: null }
  const { u, v } = pixelFromGridCoord(facePlane, target)
  const auto = (activeVoxelKind === 'ramp' || activeVoxelKind === 'wedge')
    ? classify(sampleNeighbors(model, facePlane, u, v))
    : null
  const shape = resolveBrushPreview(activeVoxelKind, brushRotation, auto)
  if (!shape) {
    // A subdivided target uses ITS split, a plain one the armed grid: same ghost either way.
    const split = model.subdiv.get(encodeKey(...target))?.split ?? pendingSplit
    const box = split ? gridBox(target, [...split], plane, hoverQuad ? subdivDisplayBits(plane, [...split], hoverQuad[0], hoverQuad[1]) : hoverBits) : undefined
    return box ? { kind: 'cube', target, box } : { kind: 'cube', target }
  }
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
