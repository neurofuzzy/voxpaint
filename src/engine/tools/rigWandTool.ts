import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { ToolHandler } from './types'

/**
 * Rig wand tool (Animate mode): tap-only, like the magic wand. Delegates to the store's
 * `applyRigBoxAt` — a color-connected flood (exact palette slot, like the wand's first stage)
 * whose bounding box becomes a named rig selection. Single-stage, no double-tap expansion;
 * stays active so consecutive taps add consecutive boxes.
 */
export const rigWandTool: ToolHandler = {
  onDown(ctx, e) {
    ctx.applyRigBoxAt(gridCoordFromPixel(ctx.plane, e.u, e.v))
  },
}
