import * as THREE from 'three'
import { decodeKey, encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { CellKey, ChamferCell, Coord, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { forEachSelectedCell } from '@/engine/tools/selectionMask'
import type { ClipboardData, FloatOrigin, SelectionRegion } from '@/store/types'
import { chamferInstanceMatrix, cubeInstanceMatrix } from './basis'
import { poolIdFor, type PoolId } from './pools'

/**
 * One instanced draw's worth of overlay cells: everything sharing a pool, and so a geometry.
 * `colors` is per-instance tinting; omitted when the whole overlay is a single flat color.
 */
export type GhostBatch = {
  poolId: PoolId
  matrices: THREE.Matrix4[]
  colors?: THREE.Color[]
}

/** Placement for one cell, using its baked shape — the same matrix the live renderer would use. */
function instanceMatrixFor(coord: Coord, chamfer: ChamferCell | undefined): THREE.Matrix4 {
  return chamfer?.resolvedTo
    ? chamferInstanceMatrix(coord, chamfer.planeAxis, chamfer.planeOrientation, chamfer.resolvedTo.rotation)
    : cubeInstanceMatrix(coord)
}

function pushInto(byPool: Map<PoolId, GhostBatch>, coord: Coord, chamfer: ChamferCell | undefined, color?: THREE.Color): void {
  const poolId = poolIdFor(chamfer)
  let batch = byPool.get(poolId)
  if (!batch) {
    batch = { poolId, matrices: [], colors: color ? [] : undefined }
    byPool.set(poolId, batch)
  }
  batch.matrices.push(instanceMatrixFor(coord, chamfer))
  if (color) batch.colors!.push(color)
}

/**
 * Lays out the floating selection for rendering as a semi-transparent 3D ghost (see
 * `FloatGhostPreview.tsx`), grouped into the same instancing pools the live `InstancingManager`
 * uses so a float and the model it bakes into agree on every cell's shape.
 *
 * Deliberately mirrors `applyClipboardAt`'s placement exactly — same plane mapping, same bounds
 * rejection — so the ghost is a truthful preview of the bake rather than an approximation of it.
 */
export function buildFloatGhostBatches(
  floatContent: ClipboardData | null,
  floatOrigin: FloatOrigin | null,
  plane: ConstructionPlane,
  palette: PaletteState,
  gridExtent: GridExtent,
): GhostBatch[] {
  if (!floatContent || !floatOrigin) return []
  const byPool = new Map<PoolId, GhostBatch>()
  const ai = axisIndex(plane.axis)
  const samePlane =
    floatContent.copyPlaneAxis === plane.axis && floatContent.copyPlaneOrientation === plane.orientation

  for (const cell of floatContent.cells) {
    // A cell with no color paints nothing when baked, so it has nothing to ghost either.
    // (It still clears on bake — replace semantics — but clearing renders as absence.)
    if (!cell.color) continue
    const coord = gridCoordFromPixel(plane, floatOrigin.originU + cell.du, floatOrigin.originV + cell.dv)
    // Deep-lifted cells ride at their depth offset off the float slice, mirroring
    // `applyClipboardAt` (same-plane drops re-anchor to the lift slice recorded in the
    // content). The re-anchor is unconditional: exact-set lifts anchor dw off the set
    // bbox-min rather than the plane, so dw==0 does NOT mean "on the plane" for them and
    // skipping it would collapse the bottom layer onto the construction plane.
    coord[ai] = (samePlane ? (floatContent.copyPlaneOffset ?? plane.offset) : plane.offset) + cell.dw
    // Cells dragged off-grid are dropped by `applyClipboardAt` on bake — don't promise them here.
    if (!withinWorkingBounds(coord, gridExtent)) continue
    pushInto(byPool, coord, cell.chamfer, new THREE.Color(resolveSlotColor(palette, cell.color.paletteSlot)))
  }

  return [...byPool.values()]
}

/**
 * Current grid-space footprint of a pending float: every placed cell coordinate within working
 * bounds. Placement mirrors `buildFloatGhostBatches` (and therefore `applyClipboardAt`) exactly —
 * same plane mapping, same depth re-anchoring, same bounds rejection — so the box and the ghost
 * agree on where the drag is. Only cells with color are included, matching what the ghost renders
 * (colorless cells clear on bake but paint nothing, so they contribute no visible drag).
 *
 * Used by the 3D selection bounding box to track a dragged selection: a lift deletes the cells
 * out of the model, leaving the selection set stale, but the float knows where its cells live
 * right now and `floatOrigin` follows the pointer every frame.
 */
export function placedFloatCoords(
  floatContent: ClipboardData | null,
  floatOrigin: FloatOrigin | null,
  plane: ConstructionPlane,
  gridExtent: GridExtent,
): Coord[] {
  if (!floatContent || !floatOrigin) return []
  const ai = axisIndex(plane.axis)
  const samePlane =
    floatContent.copyPlaneAxis === plane.axis && floatContent.copyPlaneOrientation === plane.orientation
  const out: Coord[] = []
  for (const cell of floatContent.cells) {
    if (!cell.color) continue
    const coord = gridCoordFromPixel(plane, floatOrigin.originU + cell.du, floatOrigin.originV + cell.dv)
    // Unconditional re-anchor like the ghost and the bake: exact-set lifts anchor dw off the
    // set bbox-min rather than the plane, so dw==0 does NOT mean "on the plane" for them.
    coord[ai] = (samePlane ? (floatContent.copyPlaneOffset ?? plane.offset) : plane.offset) + cell.dw
    if (!withinWorkingBounds(coord, gridExtent)) continue
    out.push(coord)
  }
  return out
}

/**
 * Lays out the voxels under a (non-floating) selection so 3D can cast the same cyan over them that
 * the 2D canvas tints them with — the selection is otherwise invisible in 3D, leaving no clue which
 * voxels a delete or transform is about to hit.
 *
 * Only cells that actually hold a voxel are included: the selection is a rectangle-or-lasso mask
 * over the plane, and casting empty space would read as a floating cyan slab. `extraCells` lights
 * an explicit grid-space set (the 3D selection store) at every depth alongside the slice cast —
 * callers pass already-resolved keys; missing/out-of-grid keys are skipped benignly. Overlap
 * between the two casts draws once (shared dedupe set).
 *
 * No per-instance colors — the whole overlay is one flat tint, so the caller's material carries it.
 */
export function buildSelectionHighlightBatches(
  model: VoxelModel,
  plane: ConstructionPlane,
  selection: SelectionRegion | null,
  gridExtent: GridExtent,
  extraCells: Iterable<CellKey> | null = null,
): GhostBatch[] {
  if (!selection && !extraCells) return []
  const byPool = new Map<PoolId, GhostBatch>()
  const lit = new Set<string>()

  const pushCell = (coord: Coord) => {
    if (!withinWorkingBounds(coord, gridExtent)) return
    const key = encodeKey(...coord)
    if (lit.has(key) || !model.color.has(key)) return
    lit.add(key)
    pushInto(byPool, coord, model.chamfer.get(key))
  }

  if (selection) {
    forEachSelectedCell(selection, (u, v) => {
      pushCell(gridCoordFromPixel(plane, u, v))
    })
  }

  if (extraCells) {
    for (const key of extraCells) {
      pushCell(decodeKey(key))
    }
  }

  return [...byPool.values()]
}
