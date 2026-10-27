import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { boxSliceFootprint, rigDepthOf } from '@/engine/rigging/types'
import type { ToolHandler } from './types'

/**
 * Pose tool's 2D half (Animate mode): selection only — taps the topmost box footprint under
 * the cursor, deepest-first like the draw order. Boxing/moving stay on the rig tool,
 * pivots on the pivot tool, rotating in 3D (gizmo rings or drag-the-box with this tool).
 * Empty taps no-op (the inspector's empty state guides); drags do nothing.
 */
export const poseTool: ToolHandler = {
  onDown(ctx, e) {
    const du = toDisplayU(ctx.plane, e.u)
    const dv = toDisplayV(ctx.plane, e.v)
    const hit = [...ctx.rigBoxes]
      .map((b, index) => ({ box: b, index, depth: rigDepthOf(ctx.rigBoxes, b), fp: boxSliceFootprint(b, ctx.plane) }))
      .filter(({ fp }) => fp && du >= fp.uMin && du < fp.uMax && dv >= fp.vMin && dv < fp.vMax)
      .sort((a, b) => b.depth - a.depth || b.index - a.index)[0]
    if (hit) ctx.selectRigBox(hit.box.id)
  },
}
