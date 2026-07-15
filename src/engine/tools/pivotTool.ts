import type { ToolHandler } from './types'

/** Animate-mode-only: click sets (replacing any existing) the current slice's rotation/pendulum
 * pivot. One-shot, not a drag tool. Right-click-to-clear is wired in `usePixelCanvasTools.ts`'s
 * `onPointerUp`, alongside paint/erase's own quick-action shortcut — right-click never reaches a
 * tool's `onDown` at all (it starts a camera-pan drag there instead). */
export const pivotTool: ToolHandler = {
  onDown(ctx, e) {
    ctx.setPivotForCurrentSlice(e.u, e.v)
  },
}
