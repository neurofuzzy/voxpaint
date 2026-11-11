import { bresenhamLine } from '@/engine/tools/lineUtils'
import { canScaffold, canSubdivide } from '@/engine/grid/subdiv'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { ToolHandler } from './types'

/**
 * Subdivide tool: splits plain cubes into half-scale detail ("rough in, detail down"),
 * and splits empty space into paint scaffolds (all-null detail parents with the active
 * slot as placeholder — invisible in 3D until painted, dimmed guides in 2D).
 * A tap splits with the toolbar's pending division (Alt forces the full 2×2×2 split as a
 * momentary override); tapping an already-subdivided cell advances it through its own
 * family's divisions (same child count), coarsening back to whole past the end — a
 * different toolbar family re-splits instead. A scaffold coarsens back to empty. Drag
 * splits every plain cube and empty cell entered (never touches subdivided cells mid-drag,
 * so sweeping a patch can't merge or re-split existing detail).
 *
 * Custom down/move/up rhythm instead of `makeEditTool`: the tap-vs-drag semantics differ
 * (advance vs split-only), so the shared paint/erase shell doesn't fit. One undo stroke
 * per gesture either way, bracketed here.
 */
export const subdivideTool: ToolHandler = {
  onDown(ctx, e) {
    ctx.bakeFloatIfAny()
    ctx.beginStroke()
    ctx.drag.current = { kind: 'subdivide', anchor: [e.u, e.v], last: [e.u, e.v], moved: false }
  },

  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'subdivide') return
    const drag = ctx.drag.current
    const [lu, lv] = drag.last
    if (lu === e.u && lv === e.v) return
    drag.moved = true
    // Split-only on drag: fresh cubes and empty cells split with the pending division
    // (Alt: full) — the tool never touches subdivided cells mid-drag, so sweeping a patch
    // can't merge or re-split existing detail. Chamfered cells are skipped silently
    // (they toast only on tap).
    const pending = e.altKey ? (['x', 'y', 'z'] as const) : ctx.pendingSplit
    if (!pending) {
      ctx.drag.current = { ...drag, last: [e.u, e.v] }
      return
    }
    for (const [u, v] of bresenhamLine(lu, lv, e.u, e.v)) {
      const coord = gridCoordFromPixel(ctx.plane, u, v)
      if (canSubdivide(ctx.model, coord) || canScaffold(ctx.model, coord)) ctx.toggleSubdivide(u, v, e.altKey)
    }
    ctx.drag.current = { ...drag, last: [e.u, e.v] }
  },

  onUp(ctx, e) {
    if (ctx.drag.current.kind !== 'subdivide') return
    const { anchor, moved } = ctx.drag.current
    // Tap (no drag): plain cells split, empty cells scaffold, subdivided cells advance
    // within their family (Alt forces full 2×2×2). Splittable cells with no pending
    // division toast a hint instead of splitting.
    if (!moved) ctx.toggleSubdivide(anchor[0], anchor[1], e.altKey)
    ctx.drag.current = { kind: 'idle' }
    ctx.commitStroke()
  },
}
