import { bresenhamLine, snapToOrtho } from '@/engine/tools/lineUtils'
import type { ToolContext, ToolHandler } from './types'

/**
 * Shared shell for paint/erase: both follow the same down->move->up rhythm (shift-click draws a
 * straight line preview + flush, a plain drag paints/erases a stroke via Bresenham interpolation,
 * a no-move click applies once at the down position) — mirrors trixelart's `makeEditTool` factory,
 * parameterized by the per-cell operation instead of duplicating the drag-state machine per tool.
 */
export function makeEditTool(apply: (ctx: ToolContext, u: number, v: number) => void): ToolHandler {
  return {
    onDown(ctx, e) {
      // Explicit bake BEFORE this tool's own beginStroke(): this wraps many cell writes across a
      // drag into one undo stroke, so if a float were baked *after* beginStroke() here, the
      // bake's own internal begin/commit cycle would clobber this stroke's baseline (see
      // toolActionsSlice comment) and silently drop the stroke from undo history.
      ctx.bakeFloatIfAny()
      ctx.beginStroke()
      ctx.drag.current = { kind: 'paint', anchor: [e.u, e.v], last: [e.u, e.v] }

      if (e.shiftKey) {
        ctx.setLinePreview({ anchor: [e.u, e.v], end: [e.u, e.v] })
        return
      }
      apply(ctx, e.u, e.v)
    },

    onMove(ctx, e) {
      if (ctx.drag.current.kind !== 'paint') return

      if (e.shiftKey) {
        const anchor = ctx.drag.current.anchor
        const [su, sv] = snapToOrtho(anchor[0], anchor[1], e.u, e.v)
        ctx.setLinePreview({ anchor, end: [su, sv] })
        return
      }

      const [lu0, lv0] = ctx.drag.current.last
      if (lu0 === e.u && lv0 === e.v) return
      for (const [lu, lv] of bresenhamLine(lu0, lv0, e.u, e.v)) apply(ctx, lu, lv)
      ctx.drag.current = { ...ctx.drag.current, last: [e.u, e.v] }
    },

    onUp(ctx) {
      if (ctx.drag.current.kind !== 'paint') return

      if (ctx.linePreview) {
        const { anchor, end } = ctx.linePreview
        for (const [lu, lv] of bresenhamLine(anchor[0], anchor[1], end[0], end[1])) apply(ctx, lu, lv)
      }
      ctx.setLinePreview(null)
      ctx.drag.current = { kind: 'idle' }
      ctx.commitStroke()
    },
  }
}
