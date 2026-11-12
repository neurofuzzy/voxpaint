import { encodeKey } from '@/engine/grid/GridStore'
import { visibleChildAt } from '@/engine/grid/subdiv'
import type { ChamferCell } from '@/engine/grid/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { quadrantFromFractions } from '@/engine/tools/quadrant'
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
    const subdiv = cell ? undefined : ctx.model.subdiv.get(key)
    if (subdiv) {
      // Detail samples the child the canvas shows under the pointer (see `visibleChildAt`);
      // an empty part samples nothing. Detail bevels load their frozen kind directly.
      const quad = quadrantFromFractions(ctx.plane, e.cu, e.cv) ?? [0, 0]
      const at = visibleChildAt(ctx.plane, subdiv, quad[0], quad[1])
      const picked = at === null ? null : subdiv.children[at]
      if (!picked) return
      ctx.setActivePaletteSlot(picked.slot)
      ctx.setActiveVoxelKind(voxelKindForCell(picked.chamfer))
      ctx.setActiveTool('paint')
      return
    }
    if (!cell) return
    ctx.setActivePaletteSlot(cell.paletteSlot)
    ctx.setActiveVoxelKind(voxelKindForCell(ctx.model.chamfer.get(key)))
    ctx.setActiveTool('paint') // after picking, drop straight into painting with the picked color and type
  },
}
