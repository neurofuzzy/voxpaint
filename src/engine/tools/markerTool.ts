import type { ToolHandler } from './types'

/**
 * Marker tool: click an empty plane cell to drop a marker in the active palette color (one
 * undo stroke per click); drag an existing marker to move it (one undo stroke per drag).
 * Tapping an existing marker without dragging resolves by color: a different-colored marker
 * takes the active color, a same-colored one is deleted. Right-click quick-delete lives in
 * `usePixelCanvasTools.ts`'s onPointerUp alongside paint/erase's quick-erase — right-click
 * never reaches a tool's `onDown`.
 */
export const markerTool: ToolHandler = {
  onDown(ctx, e) {
    if (e.button === 2) return
    ctx.bakeFloatIfAny()
    ctx.beginStroke()
    const existing = ctx.markerAtCoord(e.u, e.v)
    if (existing) {
      ctx.selectMarker(existing.id)
      // Defer tap-vs-drag: a release on this cell recolors/deletes, leaving it moves.
      ctx.drag.current = { kind: 'marker-pending', id: existing.id, startU: e.u, startV: e.v }
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
    const drag = ctx.drag.current
    if (drag.kind === 'marker-pending') {
      if (e.u === drag.startU && e.v === drag.startV) return
      // Dragged off the start cell — this is a move, not a tap.
      ctx.drag.current = { kind: 'marker', id: drag.id }
      ctx.moveMarkerToCoord(drag.id, e.u, e.v)
      return
    }
    if (drag.kind !== 'marker') return
    ctx.moveMarkerToCoord(drag.id, e.u, e.v)
  },

  onUp(ctx, e) {
    const drag = ctx.drag.current
    if (drag.kind === 'marker-pending') {
      // Pure tap on an existing marker: recolor to the active color, or delete when it
      // already has it.
      const target = ctx.markerAtCoord(drag.startU, drag.startV)
      if (target && target.id === drag.id) {
        if (target.color !== ctx.activeMarkerColor) ctx.recolorMarker(target.id, ctx.activeMarkerColor)
        else ctx.removeMarker(target.id)
      }
      ctx.drag.current = { kind: 'idle' }
      ctx.commitStroke()
      return
    }
    if (drag.kind !== 'marker') return
    ctx.moveMarkerToCoord(drag.id, e.u, e.v)
    ctx.drag.current = { kind: 'idle' }
    ctx.commitStroke()
  },
}
