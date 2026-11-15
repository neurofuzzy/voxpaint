import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { posedBoxSliceFootprint, rigDepthOf } from '@/engine/rigging/types'
import type { ToolHandler } from './types'

/**
 * Rig select tool (Animate mode, Tweens tab): selection only — taps the topmost box
 * footprint under the cursor, deepest-first like the draw order, or clears the selection
 * on an empty tap. No boxing, no moving, no pivots: everything it can't do lives on the
 * tab whose tool can (Rig for box/move/pivot, Poses for posing). Drags do nothing.
 * Footprints are the posed boxes (composed key offsets applied), matching the canvas.
 */
export const rigSelectTool: ToolHandler = {
  onDown(ctx, e) {
    const du = toDisplayU(ctx.plane, e.u)
    const dv = toDisplayV(ctx.plane, e.v)
    const hit = [...ctx.rigBoxes]
      .map((b, index) => ({ box: b, index, depth: rigDepthOf(ctx.rigBoxes, b), fp: posedBoxSliceFootprint(ctx.rigBoxes, b, ctx.plane, ctx.keyOffsets) }))
      .filter(({ fp }) => fp && du >= fp.uMin && du < fp.uMax && dv >= fp.vMin && dv < fp.vMax)
      .sort((a, b) => b.depth - a.depth || b.index - a.index)[0]
    ctx.selectRigBox(hit ? hit.box.id : null)
  },
}
