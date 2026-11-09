import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { posedBoxSliceFootprint, rigDepthOf } from '@/engine/rigging/types'
import type { ToolHandler } from './types'

/**
 * Rig tool (Animate mode): the mode's primary selection/move gesture, since rig boxes are what
 * you edit here and the voxel model underneath is just an underlay.
 *
 * - Tap a box footprint: selects it (tap without dragging is selection only).
 * - Drag a box footprint: moves the whole part across the slice — the box, its subtree, and
 *   the voxels inside them travel together (one undo step, pivots riding along, clamped to
 *   the working cube), so separate pieces can be posed into place then parented ("glued") in
 *   the outline. Overlap fuses on drop (scrubbing back restores everything).
 * - Tap anywhere else: boxes the color-connected flood (exact palette slot) into a new named
 *   rig selection, as before. Stays active so consecutive taps add consecutive boxes.
 *
 * Hit-testing is deepest-first (a nested box wins over its ancestors), ties broken in favor
 * of later rows — matching draw order, so the topmost visible footprint is what you grab.
 * Footprints are the posed boxes (composed key offsets applied), matching the canvas —
 * a part-move grab edits bind, but it starts from where the box visibly is.
 */
export const rigWandTool: ToolHandler = {
  onDown(ctx, e) {
    const du = toDisplayU(ctx.plane, e.u)
    const dv = toDisplayV(ctx.plane, e.v)
    const hit = [...ctx.rigBoxes]
      .map((b, index) => ({ box: b, index, depth: rigDepthOf(ctx.rigBoxes, b), fp: posedBoxSliceFootprint(ctx.rigBoxes, b, ctx.plane, ctx.keyOffsets) }))
      .filter(({ fp }) => fp && du >= fp.uMin && du < fp.uMax && dv >= fp.vMin && dv < fp.vMax)
      .sort((a, b) => b.depth - a.depth || b.index - a.index)[0]
    if (hit) {
      ctx.selectRigBox(hit.box.id)
      if (ctx.beginPartMove(hit.box.id)) {
        ctx.drag.current = { kind: 'rig-move', id: hit.box.id, startU: e.u, startV: e.v }
      } else {
        ctx.drag.current = { kind: 'idle' }
      }
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
    const { startU, startV } = ctx.drag.current
    if (startU === e.u && startV === e.v) return
    // Absolute world-space delta from the press cell (grid cells, not display space, so
    // mirrored planes can't flip the direction; the offset-axis component is inherently 0 —
    // moves stay on the slice). Absolute (not incremental) so pressing against the cube wall
    // then steering back recovers exactly instead of ratcheting.
    const from = gridCoordFromPixel(ctx.plane, startU, startV)
    const to = gridCoordFromPixel(ctx.plane, e.u, e.v)
    ctx.updatePartMove([to[0] - from[0], to[1] - from[1], to[2] - from[2]])
  },

  onUp(ctx) {
    if (ctx.drag.current.kind !== 'rig-move') return
    ctx.drag.current = { kind: 'idle' }
    ctx.endPartMove()
  },
}
