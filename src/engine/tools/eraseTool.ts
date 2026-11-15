import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { makeEditTool } from './editToolFactory'

export const eraseTool = makeEditTool((ctx, u, v, quad) => {
  ctx.eraseCell(gridCoordFromPixel(ctx.plane, u, v), quad?.[0], quad?.[1])
})
