import { makeEditTool } from './editToolFactory'

export const paintTool = makeEditTool((ctx, u, v) => {
  ctx.paintCell(u, v)
})
