import { encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { ToolHandler } from './types'

export const eyedropperTool: ToolHandler = {
  onDown(ctx, e) {
    const coord = gridCoordFromPixel(ctx.plane, e.u, e.v)
    const cell = ctx.model.color.get(encodeKey(...coord))
    if (!cell) return
    ctx.setActivePaletteSlot(cell.paletteSlot)
    ctx.setActiveTool('paint') // after picking, drop straight into painting with the picked color
  },
}
