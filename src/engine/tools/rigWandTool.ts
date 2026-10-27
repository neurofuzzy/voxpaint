import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { boxSliceFootprint, rigDepthOf } from '@/engine/rigging/types'
import type { ToolHandler } from './types'

/**
 * Rig tool (Animate mode): the mode's primary selection/move gesture, since rig boxes are what
 * you edit here and the voxel model underneath is just an underlay.
 *
 * - Tap a box footprint: selects it (tap without dragging is selection only).
 * - Drag a box footprint: slides the box and its whole subtree across the slice (one undo
 *   step, pivots riding along, clamped to the working cube).
 * - Tap anywhere else: boxes the color-connected flood (exact palette slot) into a new named
 *   rig selection, as before. Stays active so consecutive taps add consecutive boxes.
 *
 * Hit-testing is deepest-first (a nested box wins over its ancestors), ties broken in favor
 * of later rows — matching draw order, so the topmost visible footprint is what you grab.
 */
export const rigWandTool: ToolHandler = {
  onDown(ctx, e) {
    const du = toDisplayU(ctx.plane, e.u)
    const dv = toDisplayV(ctx.plane, e.v)
    const hit = [...ctx.rigBoxes]
      .map((b, index) => ({ box: b, index, depth: rigDepthOf(ctx.rigBoxes, b), fp: boxSliceFootprint(b, ctx.plane) }))
      .filter(({ fp }) => fp && du >= fp.uMin && du < fp.uMax && dv >= fp.vMin && dv < fp.vMax)
      .sort((a, b) => b.depth - a.depth || b.index - a.index)[0]
    if (hit) {
      ctx.selectRigBox(hit.box.id)
      ctx.animBeginStroke()
      ctx.drag.current = { kind: 'rig-move', id: hit.box.id, lastU: e.u, lastV: e.v }
      return
    }
    // Fresh tap outside any footprint — clear any drag state orphaned by an interrupted
    // gesture (e.g. a spring-loaded tool switch mid-drag) so a stale move can't leak into
    // the next drag.
    ctx.drag.current = { kind: 'idle' }
    ctx.applyRigBoxAt(gridCoordFromPixel(ctx.plane, e.u, e.v))
  },

  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'rig-move') return
    const { id, lastU, lastV } = ctx.drag.current
    if (lastU === e.u && lastV === e.v) return
    // Deltas resolve through grid cells (not display space) so mirrored planes can't flip
    // the direction; the offset-axis component is inherently 0 — moves stay on the slice.
    const from = gridCoordFromPixel(ctx.plane, lastU, lastV)
    const to = gridCoordFromPixel(ctx.plane, e.u, e.v)
    ctx.translateRigBox(id, [to[0] - from[0], to[1] - from[1], to[2] - from[2]])
    ctx.drag.current = { ...ctx.drag.current, lastU: e.u, lastV: e.v }
  },

  onUp(ctx) {
    if (ctx.drag.current.kind !== 'rig-move') return
    ctx.drag.current = { kind: 'idle' }
    ctx.animCommitStroke()
  },
}
