import * as THREE from 'three'
import { encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { ChamferCell, Coord, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
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

  for (const cell of floatContent.cells) {
    // A cell with no color paints nothing when baked, so it has nothing to ghost either.
    if (!cell.color) continue
    const coord = gridCoordFromPixel(plane, floatOrigin.originU + cell.du, floatOrigin.originV + cell.dv)
    // Cells dragged off-grid are dropped by `applyClipboardAt` on bake — don't promise them here.
    if (!withinWorkingBounds(coord, gridExtent)) continue
    pushInto(byPool, coord, cell.chamfer, new THREE.Color(resolveSlotColor(palette, cell.color.paletteSlot)))
  }

  return [...byPool.values()]
}

/**
 * Lays out the voxels under a (non-floating) selection so 3D can cast the same cyan over them that
 * the 2D canvas tints them with — the selection is otherwise invisible in 3D, leaving no clue which
 * voxels a delete or transform is about to hit.
 *
 * Only cells that actually hold a voxel are included: the selection is a rectangle-or-lasso mask
 * over the plane, and casting empty space would read as a floating cyan slab. Since a selection
 * lives on one construction-plane slice, only that slice ever lights up.
 *
 * No per-instance colors — the whole overlay is one flat tint, so the caller's material carries it.
 */
export function buildSelectionHighlightBatches(
  model: VoxelModel,
  plane: ConstructionPlane,
  selection: SelectionRegion | null,
  gridExtent: GridExtent,
): GhostBatch[] {
  if (!selection) return []
  const byPool = new Map<PoolId, GhostBatch>()

  forEachSelectedCell(selection, (u, v) => {
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, gridExtent)) return
    const key = encodeKey(...coord)
    if (!model.color.has(key)) return
    pushInto(byPool, coord, model.chamfer.get(key))
  })

  return [...byPool.values()]
}
