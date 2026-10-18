import { encodeKey } from '@/engine/grid/GridStore'
import type { ChamferCell } from '@/engine/grid/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { VoxelKind } from '@/store/types'
import type { ToolHandler } from './types'

/**
 * Maps a sampled cell's chamfer entry to the paint-tool voxel kind that produces that shape.
 * Plain cubes carry no chamfer entry; only the ramp autotile kind can be unresolved (still
 * cube-rendered) — wedges and every explicit kind always resolve at paint time. Since the
 * palette carries explicit outer/inner corner kinds, sampling a convex/concave cell loads that
 * kind directly (even for legacy autotiled corners): what you pick is what you paint.
 */
export function voxelKindForCell(chamfer: ChamferCell | undefined): VoxelKind {
  const shape = chamfer?.resolvedTo?.shapeKind
  if (!shape) return chamfer ? 'ramp' : 'cube'
  if (shape === 'ramp') return 'ramp'
  return shape
}

export const eyedropperTool: ToolHandler = {
  onDown(ctx, e) {
    const coord = gridCoordFromPixel(ctx.plane, e.u, e.v)
    const key = encodeKey(...coord)
    const cell = ctx.model.color.get(key)
    if (!cell) return
    ctx.setActivePaletteSlot(cell.paletteSlot)
    ctx.setActiveVoxelKind(voxelKindForCell(ctx.model.chamfer.get(key)))
    ctx.setActiveTool('paint') // after picking, drop straight into painting with the picked color and type
  },
}
