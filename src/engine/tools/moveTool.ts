import type { ToolHandler } from './types'

/**
 * Move directly translates voxels — no selection, no float. A plain drag shifts every voxel on the
 * current plane slice; holding Alt shifts the entire model. Both move along the current plane's u/v
 * axes, live during the drag, as a single undo step. (Repositioning a *partial* selection is the
 * Select tool's job — drag inside an active selection.)
 */
export const moveTool: ToolHandler = {
  onDown(ctx, e) {
    ctx.beginMove(e.altKey)
    ctx.drag.current = { kind: 'moveGrid', startU: e.u, startV: e.v, lastU: e.u, lastV: e.v }
  },

  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'moveGrid') return
    const { startU, startV, lastU, lastV } = ctx.drag.current
    if (e.u === lastU && e.v === lastV) return
    ctx.updateMove(e.u - startU, e.v - startV)
    ctx.drag.current = { ...ctx.drag.current, lastU: e.u, lastV: e.v }
  },

  onUp(ctx) {
    if (ctx.drag.current.kind !== 'moveGrid') return
    ctx.endMove()
    ctx.drag.current = { kind: 'idle' }
  },
}
