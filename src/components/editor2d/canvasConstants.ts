/** Grid-cell size in CSS px at 100% zoom (1.0). Centralized here for easy tuning. */
export const BASE_CELL_PX = 30;
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 6
/** Larger = gentler zoom per wheel tick (divisor on wheel delta before the exponential curve). */
export const WHEEL_ZOOM_SENSITIVITY = 100
/** Trackpad pinch (ctrl/meta+wheel) reports much smaller per-event deltas than a mouse wheel
 * click, so it needs a much smaller divisor to feel comparably responsive. */
export const PINCH_ZOOM_SENSITIVITY = 15

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX)
}

/** Minimum on-screen px of the grid's bounding box kept visible when panned to an extreme,
 * on every edge (uniform — including clearance from the floating palette pill at the bottom). */
export const PAN_PADDING_PX = 100
