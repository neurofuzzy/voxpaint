import { floatDragStep } from './fineFloat'
import { fineUnitAt } from './fineSelection'
import type { NormalizedPointerEvent } from '@/engine/input/PointerInputController'
import type { ToolContext, ToolHandler } from './types'

/** Pointer position in the drag's step units (half voxels along axes the grid cuts). */
function stepUnitAt(ctx: ToolContext, step: { su: 1 | 2; sv: 1 | 2 }, e: NormalizedPointerEvent): [number, number] {
  return fineUnitAt({ ...step, slab: null }, ctx.plane, e.u, e.v, e.cu, e.cv)
}

/**
 * Move directly translates voxels — no selection, no float. A plain drag shifts the current plane
 * slice (only the plane's half-voxel slab when the grid cuts the plane axis); holding Alt shifts
 * the entire model. Both move along the current plane's u/v axes in the grid's steps — half voxels
 * along each in-plane axis the grid cuts — live during the drag, as a single undo step.
 * (Repositioning a *partial* selection is the Select tool's job — drag inside an active selection.)
 */
export const moveTool: ToolHandler = {
  onDown(ctx, e) {
    ctx.beginMove(e.altKey)
    // The grid can't change mid-drag; the store measures in the same step (`floatDragStep`).
    const step = floatDragStep(ctx.plane, ctx.gridSplit) ?? { su: 1, sv: 1 }
    const at = stepUnitAt(ctx, step, e)
    ctx.drag.current = { kind: 'moveGrid', step, startFine: at, last: at }
  },

  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'moveGrid') return
    const { step, startFine, last } = ctx.drag.current
    const at = stepUnitAt(ctx, step, e)
    if (at[0] === last[0] && at[1] === last[1]) return
    ctx.updateMove(at[0] - startFine[0], at[1] - startFine[1])
    ctx.drag.current = { ...ctx.drag.current, last: at }
  },

  onUp(ctx) {
    if (ctx.drag.current.kind !== 'moveGrid') return
    ctx.endMove()
    ctx.drag.current = { kind: 'idle' }
  },
}
