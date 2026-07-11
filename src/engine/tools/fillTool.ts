import type { ToolHandler } from './types'

export const fillTool: ToolHandler = {
  onDown(ctx, e) {
    if (e.button === 2) return
    ctx.floodFill(e.u, e.v)
  },
}
