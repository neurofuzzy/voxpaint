import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { placePivotOnPlane } from '@/engine/rigging/types'
import type { ToolHandler } from './types'

/** Animate-mode pivot setting for the selected rig box (no selection = toast, nothing set).
 *
 * One click places the pivot: the click's sub-cell position snaps onto the 2x lattice (cell
 * centers and boundary intersections alike), and only the construction plane's own two axes
 * move — depth keeps the current pivot (box center when unset), so rotating the plane places
 * the third dimension, the same framing every modeling tool uses. No second-click gesture,
 * no modifiers. Right-click resets the pivot via `usePixelCanvasTools.ts`'s `onPointerUp`,
 * alongside paint/erase's own quick-action shortcut — right-click never reaches a tool's
 * `onDown` at all (it starts a camera-pan drag there instead). */
export const pivotTool: ToolHandler = {
  onDown(ctx, e) {
    // Two-click cycle needs the live box — without a selection, fall back to the store path,
    // which toasts the hint.
    const box = ctx.rigBoxes.find((b) => b.id === ctx.selectedRigBoxId)
    if (!box) {
      ctx.setPivotForCurrentSlice(e.u, e.v)
      return
    }
    // cu/cv are the click's continuous display position (pointer-down dispatch fills them);
    // without them fall back to the clicked cell's center display point.
    const cu = e.cu ?? toDisplayU(ctx.plane, e.u) + 0.5
    const cv = e.cv ?? toDisplayV(ctx.plane, e.v) + 0.5
    ctx.setRigPivot(box.id, placePivotOnPlane(box, ctx.plane, cu, cv))
  },
}
