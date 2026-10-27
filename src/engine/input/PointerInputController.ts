/**
 * Normalized pointer event shape consumed by `engine/tools/*`. Keeps tool modules free of
 * `React.PointerEvent` so they stay framework-agnostic and unit-testable (per CLAUDE.md — engine
 * has no React/JSX). Mouse-only in v1; shaped so a touch/stylus adapter can be added later by
 * writing one more `toNormalizedPointerEvent`-style function, without touching tool modules.
 */
export interface NormalizedPointerEvent {
  u: number
  v: number
  /**
   * Continuous display-space position of the pointer (pre-floor, same space `u`/`v` are
   * floored from) — sub-cell aim for tools that snap onto a finer lattice than cells, like
   * pivot placement. Optional: only pointer-down dispatch fills it; tools fall back to the
   * cell center when absent (e.g. synthetic/test events).
   */
  cu?: number
  cv?: number
  button: number
  buttons: number
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  pointerId: number
}

export function toNormalizedPointerEvent(
  e: { button: number; buttons: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; pointerId: number },
  cell: [number, number],
): NormalizedPointerEvent {
  return {
    u: cell[0],
    v: cell[1],
    button: e.button,
    buttons: e.buttons,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.ctrlKey || e.metaKey,
    pointerId: e.pointerId,
  }
}
