import { quadrantFromFractions } from './quadrant'
import type { ToolHandler } from './types'

/** Fill: plain click floods the plane slab, Alt floods the volume — both at the armed grid's
 * resolution, from the grid cell (quadrant) under the pointer. */
export const fillTool: ToolHandler = {
  onDown(ctx, e) {
    if (e.button === 2) return
    const q = quadrantFromFractions(ctx.plane, e.cu, e.cv)
    if (e.altKey) ctx.floodFill3D(e.u, e.v, q?.[0], q?.[1])
    else ctx.floodFill(e.u, e.v, q?.[0], q?.[1])
  },
}
