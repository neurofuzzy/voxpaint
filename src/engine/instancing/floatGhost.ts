import * as THREE from 'three'
import { withinWorkingBounds } from '@/engine/grid/GridStore'
import type { GridExtent } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import type { ClipboardData, FloatOrigin } from '@/store/types'
import { chamferInstanceMatrix, cubeInstanceMatrix } from './basis'
import { poolIdFor, type PoolId } from './pools'

/** One instanced draw's worth of ghost cells: every cell sharing a pool (and so a geometry). */
export type FloatGhostBatch = {
  poolId: PoolId
  matrices: THREE.Matrix4[]
  colors: THREE.Color[]
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
): FloatGhostBatch[] {
  if (!floatContent || !floatOrigin) return []
  const byPool = new Map<PoolId, FloatGhostBatch>()

  for (const cell of floatContent.cells) {
    // A cell with no color paints nothing when baked, so it has nothing to ghost either.
    if (!cell.color) continue
    const coord = gridCoordFromPixel(plane, floatOrigin.originU + cell.du, floatOrigin.originV + cell.dv)
    // Cells dragged off-grid are dropped by `applyClipboardAt` on bake — don't promise them here.
    if (!withinWorkingBounds(coord, gridExtent)) continue

    const chamfer = cell.chamfer
    const matrix = chamfer?.resolvedTo
      ? chamferInstanceMatrix(coord, chamfer.planeAxis, chamfer.planeOrientation, chamfer.resolvedTo.rotation)
      : cubeInstanceMatrix(coord)

    const poolId = poolIdFor(chamfer)
    let batch = byPool.get(poolId)
    if (!batch) {
      batch = { poolId, matrices: [], colors: [] }
      byPool.set(poolId, batch)
    }
    batch.matrices.push(matrix)
    batch.colors.push(new THREE.Color(resolveSlotColor(palette, cell.color.paletteSlot)))
  }

  return [...byPool.values()]
}
