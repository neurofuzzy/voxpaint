import { bresenhamLine } from '@/engine/tools/lineUtils'
import type { ToolContext, ToolHandler } from './types'

function stampClone(ctx: ToolContext, u: number, v: number): void {
  const offset = ctx.cloneOffsetRef.current
  if (!offset) return
  ctx.cloneStampCell(u - offset[0], v - offset[1], u, v)
}

export const cloneTool: ToolHandler = {
  onDown(ctx, e) {
    if (e.altKey) {
      ctx.cloneSourceRef.current = [e.u, e.v]
      ctx.cloneOffsetRef.current = null
      ctx.drag.current = { kind: 'idle' }
      return
    }
    if (!ctx.cloneSourceRef.current) return

    // Same ordering requirement as paintTool: bake before this tool's own beginStroke().
    ctx.bakeFloatIfAny()
    ctx.cloneOffsetRef.current = [e.u - ctx.cloneSourceRef.current[0], e.v - ctx.cloneSourceRef.current[1]]
    ctx.beginStroke()
    stampClone(ctx, e.u, e.v)
    ctx.drag.current = { kind: 'clone', last: [e.u, e.v] }
  },

  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'clone') return
    const [lu0, lv0] = ctx.drag.current.last
    if (lu0 === e.u && lv0 === e.v) return
    for (const [lu, lv] of bresenhamLine(lu0, lv0, e.u, e.v)) stampClone(ctx, lu, lv)
    ctx.drag.current = { kind: 'clone', last: [e.u, e.v] }
  },

  onUp(ctx) {
    if (ctx.drag.current.kind !== 'clone') return
    ctx.drag.current = { kind: 'idle' }
    ctx.commitStroke()
  },
}
