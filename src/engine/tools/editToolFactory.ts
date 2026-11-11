import { bresenhamLine, snapToOrtho } from '@/engine/tools/lineUtils'
import { quadrantFromFractions } from '@/engine/tools/quadrant'
import type { ToolContext, ToolHandler } from './types'

/**
 * Shared shell for paint/erase: both follow the same down->move->up rhythm (shift-click draws
 * a straight line preview + flush, a plain drag paints/erases a stroke via interpolation, a
 * no-move click applies once at the down position) — mirrors trixelart's `makeEditTool` factory,
 * parameterized by the per-cell operation instead of duplicating the drag-state machine.
 *
 * Strokes interpolate in *doubled* (half-cell) space: each cell is 2×2 quadrants, so a drag
 * from the down quadrant to the current quadrant visits every (cell, quadrant) pair along
 * the way — quadrant-precise detail painting, not cell-center jumps. Points from synthetic
 * events without a continuous position get a null quadrant (whole-cell behavior, matching the
 * pre-quadrant path exactly).
 */
export type EditToolHooks = {
  beginStroke: (ctx: ToolContext) => void
  commitStroke: (ctx: ToolContext) => void
  /** Optional end-of-stroke fix-up, run inside the open stroke after the last cell write (and
   * any shift-line flush) but before `commitStroke`, so it lands in the same undo step. */
  correctStroke?: (ctx: ToolContext) => void
}

const defaultHooks: EditToolHooks = {
  beginStroke: (ctx) => ctx.beginStroke(),
  commitStroke: (ctx) => ctx.commitStroke(),
}

/** Quadrant-precise stroke point: integer cell plus the hovered quadrant (or null). */
export type StrokePoint = { u: number; v: number; quad: [number, number] | null }

/** Doubled-space interpolation between two stroke points: every visited half-cell step
 * maps back to its (cell, quadrant), so diagonal drags across quadrants apply each one
 * exactly once instead of jumping cell-center to cell-center. Interior line points always
 * carry real quadrants; only fractionless (synthetic) endpoints fall back to null. */
export function interpolateStrokePoints(a: StrokePoint, b: StrokePoint): StrokePoint[] {
  const ax = a.u * 2 + (a.quad?.[0] ?? 0)
  const ay = a.v * 2 + (a.quad?.[1] ?? 0)
  const bx = b.u * 2 + (b.quad?.[0] ?? 0)
  const by = b.v * 2 + (b.quad?.[1] ?? 0)
  const out: StrokePoint[] = []
  let lastKey = ''
  for (const [hu, hv] of bresenhamLine(ax, ay, bx, by)) {
    // Integer division that stays exact for negative odd coordinates (Bresenham stays
    // within the doubled span, so floor semantics hold).
    const u = Math.floor(hu / 2)
    const v = Math.floor(hv / 2)
    const quad: [number, number] | null = a.quad && b.quad ? [((hu % 2) + 2) % 2, ((hv % 2) + 2) % 2] : null
    const key = `${u},${v},${quad?.[0] ?? ''},${quad?.[1] ?? ''}`
    if (key === lastKey) continue
    lastKey = key
    out.push({ u, v, quad })
  }
  return out
}

/**
 * `hooks` lets a caller redirect which undo stack a stroke lands on without duplicating the
 * drag-state machine — defaults to the voxel model's own beginStroke/commitStroke.
 */
export function makeEditTool(apply: (ctx: ToolContext, u: number, v: number, quad: [number, number] | null) => void, hooks: EditToolHooks = defaultHooks): ToolHandler {
  return {
    onDown(ctx, e) {
      // Explicit bake BEFORE this tool's own beginStroke(): this wraps many cell writes across a
      // drag into one undo stroke, so if a float were baked *after* beginStroke() here, the
      // bake's own internal begin/commit cycle would clobber this stroke's baseline (see
      // toolActionsSlice comment) and silently drop the stroke from undo history.
      ctx.bakeFloatIfAny()
      hooks.beginStroke(ctx)
      const quad = quadrantFromFractions(ctx.plane, e.cu, e.cv)
      ctx.drag.current = { kind: 'paint', anchor: [e.u, e.v], last: [e.u, e.v], anchorQuad: quad, lastQuad: quad }

      if (e.shiftKey) {
        ctx.setLinePreview({ anchor: [e.u, e.v], end: [e.u, e.v] })
        return
      }
      apply(ctx, e.u, e.v, quad)
    },

    onMove(ctx, e) {
      if (ctx.drag.current.kind !== 'paint') return

      const quad = quadrantFromFractions(ctx.plane, e.cu, e.cv)
      if (e.shiftKey) {
        const anchor = ctx.drag.current.anchor
        const [su, sv] = snapToOrtho(anchor[0], anchor[1], e.u, e.v)
        ctx.setLinePreview({ anchor, end: [su, sv] })
        return
      }

      const [lu0, lv0] = ctx.drag.current.last
      const lq = ctx.drag.current.lastQuad
      const sameCell = lu0 === e.u && lv0 === e.v
      const sameQuad = (lq?.[0] ?? -1) === (quad?.[0] ?? -1) && (lq?.[1] ?? -1) === (quad?.[1] ?? -1)
      if (sameCell && sameQuad) return
      for (const p of interpolateStrokePoints({ u: lu0, v: lv0, quad: lq ?? null }, { u: e.u, v: e.v, quad })) {
        apply(ctx, p.u, p.v, p.quad)
      }
      ctx.drag.current = { ...ctx.drag.current, last: [e.u, e.v], lastQuad: quad }
    },

    onUp(ctx, e) {
      if (ctx.drag.current.kind !== 'paint') return

      if (ctx.linePreview) {
        const { anchor, end } = ctx.linePreview
        const endQuad = quadrantFromFractions(ctx.plane, e.cu, e.cv)
        for (const p of interpolateStrokePoints({ u: anchor[0], v: anchor[1], quad: ctx.drag.current.anchorQuad ?? null }, { u: end[0], v: end[1], quad: endQuad })) {
          apply(ctx, p.u, p.v, p.quad)
        }
      }
      ctx.setLinePreview(null)
      // Same-stroke correction (e.g. bevel re-resolution against the finished stroke) before
      // the commit seals the undo step. Covers mouse-up, pen-up, and touch-release alike —
      // every pointer path funnels through this onUp.
      hooks.correctStroke?.(ctx)
      ctx.drag.current = { kind: 'idle' }
      hooks.commitStroke(ctx)
    },
  }
}
