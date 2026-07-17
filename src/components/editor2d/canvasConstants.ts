/** Grid-cell size in CSS px at 100% zoom (1.0). Centralized here for easy tuning. */
export const BASE_CELL_PX = 30;
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 6
/** Larger = gentler zoom per wheel tick (divisor on wheel delta before the exponential curve). */
export const WHEEL_ZOOM_SENSITIVITY = 100
/** Trackpad pinch (ctrl/meta+wheel) reports much smaller per-event deltas than a mouse wheel
 * click, so it needs a much smaller divisor to feel comparably responsive. */
export const PINCH_ZOOM_SENSITIVITY = 15

/** How long a solo touch waits before it commits to the active tool (paint/select/etc.) — long
 * enough that a genuine two-finger pinch's second contact (which almost never lands in the exact
 * same event as the first) arrives in time to cancel it, short enough that a real one-finger tap
 * or stroke doesn't read as laggy. Mouse/pen input is never delayed, only `pointerType: 'touch'`. */
export const TOUCH_GESTURE_DELAY_MS = 60

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX)
}

/** The grid extent that frames at zoom 1.0 — the baseline the current visuals were tuned around.
 * Also the 3D camera's reference extent (see Viewport3D.tsx's `cameraPosForExtent`). */
export const REFERENCE_GRID_EXTENT = 16

/** Default 2D zoom for a project of the given extent, chosen so the working volume occupies roughly
 * the same screen area at any locked-in size: a small grid opens zoomed in, a large one zoomed out.
 * Derived purely from the extent ratio (independent of canvas size) and clamped to the zoom range. */
export function defaultZoomForExtent(gridExtent: number): number {
  return clampZoom(REFERENCE_GRID_EXTENT / gridExtent)
}

/** Minimum on-screen px of the grid's bounding box kept visible when panned to an extreme,
 * on every edge (uniform — including clearance from the floating palette pill at the bottom). */
export const PAN_PADDING_PX = 100
