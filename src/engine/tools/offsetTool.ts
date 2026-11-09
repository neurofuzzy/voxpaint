import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { toDisplayU, toDisplayV, worldDeltaFromDisplayDelta } from '@/engine/plane/planeDisplay'
import { posedBoxSliceFootprint, rigDepthOf } from '@/engine/rigging/types'
import type { ToolHandler } from './types'

/**
 * Offset tool's 2D half (Animate mode): drag a box footprint and its keyframe offset
 * follows the pointer in the slice plane — the 2D counterpart of the 3D translate arrows,
 * for nudging parts together without leaving the editor. One undo entry per drag, and
 * the drag visibly steps through third-voxel increments (the store snaps the written
 * total live).
 *
 * - Tap a box footprint: selects it (tap without dragging is selection only).
 * - Drag a box footprint: translates the selected keyframe's offset for that box.
 * - Tap anywhere else: nothing (tap-select parity with the rotate tool's 2D half).
 *
 * Offsets live in keyframes, so a drag with no key under edit self-heals first (Key 1,
 * creating the assembly clip when none exists) instead of refusing.
 *
 * Hit-testing is deepest-first (a nested box wins over its ancestors), ties broken in favor
 * of later rows — matching draw order, so the topmost visible footprint is what you grab.
 * Footprints shift by their composed key offset (own + ancestors), so the grab target is
 * the posed box the 2D canvas draws, not its bind volume.
 *
 * Deltas are fractional and press-relative (no jump on grab, even mid-offset): the press's
 * continuous display position rides the drag state, and moves convert the display-space
 * travel back to world space, so sub-cell pointer motion yields sub-voxel offsets (thirds
 * on release). Synthetic events without a continuous position fall back to whole-cell
 * deltas.
 */
export const offsetTool: ToolHandler = {
  onDown(ctx, e) {
    const du = toDisplayU(ctx.plane, e.u)
    const dv = toDisplayV(ctx.plane, e.v)
    const hit = [...ctx.rigBoxes]
      .map((b, index) => ({ box: b, index, depth: rigDepthOf(ctx.rigBoxes, b), fp: posedBoxSliceFootprint(ctx.rigBoxes, b, ctx.plane, ctx.keyOffsets) }))
      .filter(({ fp }) => fp && du >= fp.uMin && du < fp.uMax && dv >= fp.vMin && dv < fp.vMax)
      .sort((a, b) => b.depth - a.depth || b.index - a.index)[0]
    if (hit) {
      ctx.selectRigBox(hit.box.id)
      if (ctx.beginOffsetMove(hit.box.id)) {
        ctx.drag.current = {
          kind: 'offset-move', id: hit.box.id, startU: e.u, startV: e.v,
          startCu: e.cu ?? toDisplayU(ctx.plane, e.u) + 0.5,
          startCv: e.cv ?? toDisplayV(ctx.plane, e.v) + 0.5,
        }
      } else {
        ctx.drag.current = { kind: 'idle' }
      }
      return
    }
    ctx.drag.current = { kind: 'idle' }
  },

  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'offset-move') return
    const { startU, startV, startCu, startCv } = ctx.drag.current
    if (e.cu !== undefined && startCu !== undefined && e.cv !== undefined && startCv !== undefined) {
      if (e.cu === startCu && e.cv === startCv) return
      ctx.updateOffsetMove(worldDeltaFromDisplayDelta(ctx.plane, e.cu - startCu, e.cv - startCv))
      return
    }
    if (startU === e.u && startV === e.v) return
    // Whole-cell fallback for synthetic events (no continuous position): absolute
    // world-space delta from the press cell (grid cells, not display space, so mirrored
    // planes can't flip the direction; the offset-axis component is inherently 0 — moves
    // stay on the slice).
    const from = gridCoordFromPixel(ctx.plane, startU, startV)
    const to = gridCoordFromPixel(ctx.plane, e.u, e.v)
    ctx.updateOffsetMove([to[0] - from[0], to[1] - from[1], to[2] - from[2]])
  },

  onUp(ctx) {
    if (ctx.drag.current.kind !== 'offset-move') return
    ctx.drag.current = { kind: 'idle' }
    ctx.endOffsetMove()
  },
}
