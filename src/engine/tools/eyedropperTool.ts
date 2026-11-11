import { encodeKey } from '@/engine/grid/GridStore'
import { childInSlab, quadrantSubcells } from '@/engine/grid/subdiv'
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
    // Detail reads as its stored parent slot (the 2D canvas can't address half-cells, so the
    // drop lands in cube paint — matching the 3D eyedropper's fallback on erased holes).
    const subdiv = cell ? undefined : ctx.model.subdiv.get(key)
    if (!cell && !subdiv) return
    if (subdiv) {
      // Sample the hovered quadrant's children front-first (the visible one wins), falling
      // back to the parent slot when every addressed child is erased. Half-step clips to
      // the active slab first, so the sample matches what a tap would paint.
      const quad = quadrantFromFractions(ctx.plane, e.cu, e.cv)
      const indices = quad
        ? quadrantSubcells(ctx.plane.axis, ctx.plane.orientation, subdiv.split, quad[0], quad[1])
        : subdiv.children.map((_, i) => i)
      const inSlab = indices.filter((i) => childInSlab(subdiv.split, ctx.plane.axis, ctx.plane.half, i))
      const picked = inSlab.map((i) => subdiv.children[i]).find((c) => c !== null && c !== undefined)
      ctx.setActivePaletteSlot(picked ? picked.slot : subdiv.slot)
      // Detail chamfers are frozen explicit shapes — sample the kind like a full-size cell
      // (what you pick is what you paint).
      ctx.setActiveVoxelKind(voxelKindForCell(picked?.chamfer))
      ctx.setActiveTool('paint')
      return
    }
    if (!cell) return
    ctx.setActivePaletteSlot(cell.paletteSlot)
    ctx.setActiveVoxelKind(voxelKindForCell(ctx.model.chamfer.get(key)))
    ctx.setActiveTool('paint') // after picking, drop straight into painting with the picked color and type
  },
}
