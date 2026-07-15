import type { CanvasPan, CanvasSize } from './cameraTransform'
import { PAN_PADDING_PX } from './canvasConstants'

/**
 * Camera math for the Texture-mode 2D canvas. The "world" here is a single box face's texel grid
 * (`faceSize²`, indexed 0..faceSize, `faceSize` derived from the project's own `meta.gridExtent`),
 * centered on screen — a deliberately separate coordinate system from the voxel canvas (which is
 * centered on the origin over the project's own cell span), so nothing has to be overloaded to
 * serve both. No plane / display-mirroring concept exists here.
 */
export const TEXEL_BASE_PX = 8 // CSS px per texel at zoom 1 (64 texels → ~512px at the default size)
export const TEX_ZOOM_MIN = 0.5
export const TEX_ZOOM_MAX = 16

export function texClampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, TEX_ZOOM_MIN), TEX_ZOOM_MAX)
}

export function texWorldToScreen(tu: number, tv: number, size: CanvasSize, pan: CanvasPan, zoom: number, texHalf: number): [number, number] {
  const px = TEXEL_BASE_PX * zoom
  return [size.width / 2 + px * (tu - texHalf + pan.x), size.height / 2 + px * (tv - texHalf + pan.y)]
}

export function texScreenToWorld(sx: number, sy: number, size: CanvasSize, pan: CanvasPan, zoom: number, texHalf: number): [number, number] {
  const px = TEXEL_BASE_PX * zoom
  return [(sx - size.width / 2) / px - pan.x + texHalf, (sy - size.height / 2) / px - pan.y + texHalf]
}

/** Keep the face's texel box from being dragged fully off-screen (mirrors `clampPan`). */
export function texClampPan(pan: CanvasPan, size: CanvasSize, zoom: number, texHalf: number): CanvasPan {
  const px = TEXEL_BASE_PX * zoom
  const minX = (PAN_PADDING_PX - size.width / 2) / px - texHalf
  const maxX = (size.width / 2 - PAN_PADDING_PX) / px + texHalf
  const minY = (PAN_PADDING_PX - size.height / 2) / px - texHalf
  const maxY = (size.height / 2 - PAN_PADDING_PX) / px + texHalf
  return {
    x: Math.min(Math.max(pan.x, minX), maxX),
    y: Math.min(Math.max(pan.y, minY), maxY),
  }
}
