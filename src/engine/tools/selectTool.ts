import { withinWorkingBounds } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { bresenhamLine } from '@/engine/tools/lineUtils'
import { isCellSelected, lassoRegion, rectRegion } from '@/engine/tools/selectionMask'
import type { ToolHandler } from './types'

export const selectTool: ToolHandler = {
  onDown(ctx, e) {
    const { selection, floatContent, floatOrigin, plane, gridExtent } = ctx

    if (floatContent && selection && isCellSelected(selection, e.u, e.v)) {
      // Continuing to drag the same pending float.
      ctx.drag.current = { kind: 'moveFloat', startU: e.u, startV: e.v, originAtStart: floatOrigin! }
      return
    }
    if (floatContent) {
      // Clicked outside the pending float — bake it, then fall through to starting a fresh selection.
      ctx.bakeFloatIfAny()
    } else if (selection && isCellSelected(selection, e.u, e.v)) {
      // Click inside an existing (non-floating) selection lifts + starts dragging it — no
      // separate "Move" tool needed for this; Select handles both selecting and repositioning.
      ctx.liftSelectionToFloat()
      ctx.drag.current = {
        kind: 'moveFloat',
        startU: e.u,
        startV: e.v,
        originAtStart: { originU: selection.originU, originV: selection.originV },
      }
      return
    }

    // Click/tap outside the paintable grid (the margin around the model in the 2D view) — treat
    // like clicking blank canvas in any raster editor: clear the selection instead of starting a
    // new one, rather than anchoring a 1x1 selectRect on a cell that can never hold paint.
    if (!withinWorkingBounds(gridCoordFromPixel(plane, e.u, e.v), gridExtent)) {
      ctx.setSelection(null)
      ctx.drag.current = { kind: 'idle' }
      return
    }

    if (e.altKey) {
      ctx.drag.current = { kind: 'selectLasso', points: [[e.u, e.v]] }
      ctx.setSelectPreview(null)
    } else {
      ctx.drag.current = { kind: 'selectRect', anchor: [e.u, e.v] }
      ctx.setSelectPreview(rectRegion(e.u, e.v, e.u, e.v))
    }
  },

  onMove(ctx, e) {
    const drag = ctx.drag.current
    if (drag.kind === 'moveFloat') {
      const { startU, startV, originAtStart } = drag
      ctx.moveFloatTo(originAtStart.originU + (e.u - startU), originAtStart.originV + (e.v - startV))
      return
    }
    if (drag.kind === 'selectLasso') {
      const points = drag.points
      const last = points[points.length - 1]
      if (last[0] === e.u && last[1] === e.v) return
      for (const p of bresenhamLine(last[0], last[1], e.u, e.v)) points.push(p)
      ctx.setSelectPreview(lassoRegion(points))
      return
    }
    if (drag.kind === 'selectRect') {
      ctx.setSelectPreview(rectRegion(drag.anchor[0], drag.anchor[1], e.u, e.v))
    }
  },

  onUp(ctx) {
    const drag = ctx.drag.current
    if (drag.kind === 'moveFloat') {
      ctx.drag.current = { kind: 'idle' }
      // No bake here — stays pending until an explicit bake trigger, matching float semantics
      // used everywhere else (Escape, a genuinely new selection, or any other mutating action).
      return
    }
    const region = drag.kind === 'selectLasso' ? lassoRegion(drag.points) : ctx.selectPreview
    ctx.setSelection(region) // bakes any pending float internally (selectionSlice.setSelection)
    ctx.setSelectPreview(null)
    ctx.drag.current = { kind: 'idle' }
  },
}
