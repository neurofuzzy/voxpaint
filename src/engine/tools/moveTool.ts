import { fullCanvasRegion, isCellSelected } from '@/engine/tools/selectionMask'
import type { ToolHandler } from './types'

/**
 * Move shifts every pixel visible on the current plane slice — like a "shift the whole canvas"
 * tool — regardless of any existing partial selection. Dragging a *partial* selection is the
 * Select tool's job (drag inside an active selection lifts + moves just that region); Move is
 * intentionally selection-agnostic so there's no need for a separate tool to reposition a
 * selection vs. the whole slice.
 */
export const moveTool: ToolHandler = {
  onDown(ctx, e) {
    const { floatContent, floatOrigin, selection } = ctx

    if (floatContent && selection && isCellSelected(selection, e.u, e.v)) {
      // Continuing to drag the same pending (whole-slice) float.
      ctx.drag.current = { kind: 'moveFloat', startU: e.u, startV: e.v, originAtStart: floatOrigin! }
      return
    }
    if (floatContent) ctx.bakeFloatIfAny()

    const whole = fullCanvasRegion()
    ctx.setSelection(whole)
    ctx.liftSelectionToFloat()
    ctx.drag.current = { kind: 'moveFloat', startU: e.u, startV: e.v, originAtStart: { originU: whole.originU, originV: whole.originV } }
  },

  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'moveFloat') return
    const { startU, startV, originAtStart } = ctx.drag.current
    ctx.moveFloatTo(originAtStart.originU + (e.u - startU), originAtStart.originV + (e.v - startV))
  },

  onUp(ctx) {
    if (ctx.drag.current.kind === 'moveFloat') ctx.drag.current = { kind: 'idle' }
    // Deliberately no bake here — the float stays pending until an explicit bake trigger
    // (Escape, starting a new selection, or any other model-mutating action).
  },
}
