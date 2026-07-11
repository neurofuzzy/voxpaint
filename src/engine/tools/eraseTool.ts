import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { makeEditTool } from './editToolFactory'

export const eraseTool = makeEditTool((ctx, u, v) => {
  ctx.eraseCell(gridCoordFromPixel(ctx.plane, u, v), ctx.activeLayer)
})
