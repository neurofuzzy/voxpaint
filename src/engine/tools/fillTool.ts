import type { ToolHandler } from './types'

export const fillTool: ToolHandler = {
  onDown(ctx, e) {
    if (e.button === 2) return
    if (e.altKey) ctx.floodFill3D(e.u, e.v)
    else ctx.floodFill(e.u, e.v)
  },
}
