import type { ToolHandler } from './types'

/**
 * Marker tool: click an empty plane cell to drop a labeled design marker there (one undo
 * stroke per click), click an existing marker to select it, drag to move it (one undo stroke
 * per drag). Right-click quick-delete lives in `usePixelCanvasTools.ts`'s onPointerUp alongside
 * paint/erase's quick-erase — right-click never reaches a tool's `onDown`.
 */
export const markerTool: ToolHandler = {
  onDown(ctx, e) {
    if (e.button === 2) return
    ctx.bakeFloatIfAny()
    ctx.beginStroke()
    const existing = ctx.markerAtCoord(e.u, e.v)
    if (existing) {
      ctx.selectMarker(existing.id)
      ctx.drag.current = { kind: 'marker', id: existing.id }
      return
    }
    const created = ctx.addMarkerAtCoord(e.u, e.v)
    if (created) {
      ctx.drag.current = { kind: 'marker', id: created.id }
    } else {
      // Out of bounds — nothing to record.
      ctx.drag.current = { kind: 'idle' }
      ctx.commitStroke()
    }
  },

  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'marker') return
    ctx.moveMarkerToCoord(ctx.drag.current.id, e.u, e.v)
  },

  onUp(ctx, e) {
    if (ctx.drag.current.kind !== 'marker') return
    ctx.moveMarkerToCoord(ctx.drag.current.id, e.u, e.v)
    ctx.drag.current = { kind: 'idle' }
    ctx.commitStroke()
  },
}
