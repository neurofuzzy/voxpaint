import { withinWorkingBounds } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { bresenhamLine } from '@/engine/tools/lineUtils'
import { fineDivisionFor, fineLassoRegion, fineRectRegion, fineUnitAt, isFineSelected } from '@/engine/tools/fineSelection'
import { draggedFloatOrigin, floatDragStep } from '@/engine/tools/fineFloat'
import { isCellSelected } from '@/engine/tools/selectionMask'
import type { NormalizedPointerEvent } from '@/engine/input/PointerInputController'
import type { ToolContext, ToolHandler } from './types'

/** Whether the pointer is inside the selection — per fine cell for a sub-voxel selection. */
function selectionContains(selection: NonNullable<ToolContext['selection']>, ctx: ToolContext, e: NormalizedPointerEvent): boolean {
  if (!isCellSelected(selection, e.u, e.v)) return false
  const f = selection.fine
  if (!f) return true
  const [fu, fv] = fineUnitAt({ su: f.su, sv: f.sv, slab: null }, ctx.plane, e.u, e.v, e.cu, e.cv)
  return isFineSelected(selection, fu, fv)
}

export const selectTool: ToolHandler = {
  onDown(ctx, e) {
    const { selection, floatContent, floatOrigin, plane, gridExtent } = ctx

    if (floatContent && selection && isCellSelected(selection, e.u, e.v)) {
      // Continuing to drag the same pending float, in the grid's steps.
      const step = floatDragStep(plane, ctx.gridSplit)
      ctx.drag.current = { kind: 'moveFloat', startU: e.u, startV: e.v, originAtStart: floatOrigin!,
        startFine: step ? fineUnitAt({ ...step, slab: null }, plane, e.u, e.v, e.cu, e.cv) : undefined,
        fineStep: step ?? undefined }
      return
    }
    if (floatContent) {
      // Clicked outside the pending float — bake it, then fall through to starting a fresh selection.
      ctx.bakeFloatIfAny()
    } else if (selection && !(selection.fine && e.altKey) && selectionContains(selection, ctx, e)) {
      // Click inside an existing (non-floating) selection lifts + starts dragging it — no
      // separate "Move" tool needed for this; Select handles both selecting and repositioning.
      // Alt-drag lifts the full-depth cuboid under the selection window (like the Move tool's
      // Alt-drag moves the whole model); a plain drag lifts just the current slice.
      ctx.liftSelectionToFloat(e.altKey)
      // The drag steps at the grid's resolution, whatever the content (whole-step snapping for
      // whole chamfer cells is enforced where the origin lands — the store — not here).
      const step = floatDragStep(plane, ctx.gridSplit)
      ctx.drag.current = {
        kind: 'moveFloat',
        startU: e.u,
        startV: e.v,
        originAtStart: { originU: selection.originU, originV: selection.originV, subU: 0, subV: 0 },
        startFine: step ? fineUnitAt({ ...step, slab: null }, plane, e.u, e.v, e.cu, e.cv) : undefined,
        fineStep: step ?? undefined,
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
      // The lasso traces at the grid's resolution too (fine units; whole cells under the whole grid).
      const div = fineDivisionFor(ctx.plane, ctx.gridSplit)
      ctx.drag.current = { kind: 'selectLasso', points: [fineUnitAt(div, ctx.plane, e.u, e.v, e.cu, e.cv)], div }
      ctx.setSelectPreview(null)
    } else {
      // Resolution follows the grid: with a division armed the marquee snaps to its fine cells.
      const div = fineDivisionFor(ctx.plane, ctx.gridSplit)
      const f = fineUnitAt(div, ctx.plane, e.u, e.v, e.cu, e.cv)
      ctx.drag.current = { kind: 'selectRect', anchor: [e.u, e.v], fineAnchor: f }
      ctx.setSelectPreview(fineRectRegion(div, f[0], f[1], f[0], f[1]))
    }
  },

  onMove(ctx, e) {
    const drag = ctx.drag.current
    if (drag.kind === 'moveFloat') {
      const { startU, startV, originAtStart, startFine } = drag
      // The step was fixed at press time (the grid can't change mid-drag).
      const step = drag.fineStep
      if (step && startFine) {
        // Half-voxel steps along the axes the grid cuts (the store snaps whole-chamfer content).
        const f = fineUnitAt({ ...step, slab: null }, ctx.plane, e.u, e.v, e.cu, e.cv)
        const o = draggedFloatOrigin(originAtStart, step, f[0] - startFine[0], f[1] - startFine[1])
        ctx.moveFloatTo(o.originU, o.originV, o.subU, o.subV)
        return
      }
      // Whole-voxel steps keep whatever half-voxel offset the float already has.
      ctx.moveFloatTo(originAtStart.originU + (e.u - startU), originAtStart.originV + (e.v - startV), originAtStart.subU, originAtStart.subV)
      return
    }
    if (drag.kind === 'selectLasso') {
      const points = drag.points
      const div = drag.div ?? { su: 1, sv: 1, slab: null }
      const at = fineUnitAt(div, ctx.plane, e.u, e.v, e.cu, e.cv)
      const last = points[points.length - 1]
      if (last[0] === at[0] && last[1] === at[1]) return
      for (const p of bresenhamLine(last[0], last[1], at[0], at[1])) points.push(p)
      ctx.setSelectPreview(fineLassoRegion(div, points))
      return
    }
    if (drag.kind === 'selectRect') {
      const div = fineDivisionFor(ctx.plane, ctx.gridSplit)
      const a = drag.fineAnchor ?? [drag.anchor[0] * div.su, drag.anchor[1] * div.sv]
      const f = fineUnitAt(div, ctx.plane, e.u, e.v, e.cu, e.cv)
      ctx.setSelectPreview(fineRectRegion(div, a[0], a[1], f[0], f[1]))
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
    const region = drag.kind === 'selectLasso' ? fineLassoRegion(drag.div ?? { su: 1, sv: 1, slab: null }, drag.points) : ctx.selectPreview
    ctx.setSelection(region) // bakes any pending float internally (selectionSlice.setSelection)
    ctx.setSelectPreview(null)
    ctx.drag.current = { kind: 'idle' }
  },
}
