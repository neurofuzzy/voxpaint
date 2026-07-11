import { BASE_CELL_PX, HALF, PAN_PADDING_PX } from './canvasConstants'

export interface CanvasSize {
  width: number
  height: number
}

export interface CanvasPan {
  x: number
  y: number
}

/** World (grid-cell) coordinates to screen (CSS px, canvas-local) coordinates. */
export function worldToScreen(u: number, v: number, size: CanvasSize, pan: CanvasPan, zoom: number): [number, number] {
  const cellPx = BASE_CELL_PX * zoom
  return [size.width / 2 + cellPx * (u + pan.x), size.height / 2 + cellPx * (v + pan.y)]
}

/** Inverse of `worldToScreen` — screen (CSS px) to continuous world (grid-cell) coordinates. */
export function screenToWorld(sx: number, sy: number, size: CanvasSize, pan: CanvasPan, zoom: number): [number, number] {
  const cellPx = BASE_CELL_PX * zoom
  return [(sx - size.width / 2) / cellPx - pan.x, (sy - size.height / 2) / cellPx - pan.y]
}

/**
 * Clamps pan so the grid's bounding box ([-HALF,HALF] world units) can never be dragged
 * entirely off-screen — each edge is allowed to retreat only until `PAN_PADDING_PX` of the
 * grid remains visible.
 */
export function clampPan(pan: CanvasPan, size: CanvasSize, zoom: number): CanvasPan {
  const cellPx = BASE_CELL_PX * zoom
  const minX = (PAN_PADDING_PX - size.width / 2) / cellPx - HALF
  const maxX = (size.width / 2 - PAN_PADDING_PX) / cellPx + HALF
  const minY = (PAN_PADDING_PX - size.height / 2) / cellPx - HALF
  const maxY = (size.height / 2 - PAN_PADDING_PX) / cellPx + HALF
  return {
    x: Math.min(Math.max(pan.x, minX), maxX),
    y: Math.min(Math.max(pan.y, minY), maxY),
  }
}
