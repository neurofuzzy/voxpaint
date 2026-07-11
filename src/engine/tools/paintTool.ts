import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { makeEditTool } from './editToolFactory'

export const paintTool = makeEditTool((ctx, u, v) => {
  if (ctx.activeLayer === 'chamfer') {
    ctx.paintChamferCell(u, v)
  } else {
    ctx.paintColorCell(gridCoordFromPixel(ctx.plane, u, v))
  }
})
