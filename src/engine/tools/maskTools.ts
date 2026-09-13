import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { makeEditTool, type EditToolHooks } from './editToolFactory'

const maskHooks: EditToolHooks = {
  beginStroke: (ctx) => ctx.animBeginStroke(),
  commitStroke: (ctx) => ctx.animCommitStroke(),
}

/** Animate-mode analog of `paintTool`/`eraseTool`: paints/erases the current slice's animation
 * mask instead of voxel color, using the same drag machinery and its own (Animate-mode) undo
 * stack via `maskHooks`. */
export const maskPaintTool = makeEditTool((ctx, u, v) => {
  ctx.paintMaskCell(u, v)
}, maskHooks)

export const maskEraseTool = makeEditTool((ctx, u, v) => {
  ctx.eraseMaskCell(gridCoordFromPixel(ctx.plane, u, v))
}, maskHooks)
