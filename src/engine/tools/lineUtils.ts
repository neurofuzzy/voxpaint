/** Bresenham line, inclusive of both endpoints. */
export function bresenhamLine(u0: number, v0: number, u1: number, v1: number): Array<[number, number]> {
  const points: Array<[number, number]> = []
  let x0 = u0
  let y0 = v0
  const dx = Math.abs(u1 - u0)
  const dy = -Math.abs(v1 - v0)
  const sx = u0 < u1 ? 1 : -1
  const sy = v0 < v1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    points.push([x0, y0])
    if (x0 === u1 && y0 === v1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  return points
}

/** Snaps (u1,v1) so the vector from (u0,v0) lands on a 0/45/90-degree increment. */
export function snapToOrtho(u0: number, v0: number, u1: number, v1: number): [number, number] {
  const du = u1 - u0
  const dv = v1 - v0
  const angle = Math.atan2(dv, du)
  const step = Math.PI / 4
  const snapped = Math.round(angle / step) * step
  const dist = Math.hypot(du, dv)
  return [Math.round(u0 + Math.cos(snapped) * dist), Math.round(v0 + Math.sin(snapped) * dist)]
}

/**
 * `snapToOrtho` at a grid's resolution: points are fine units (`su`×`sv` per cell), the 45°
 * snap is measured in display space (a fine unit is 1/s of a cell), and the end lands on a fine
 * unit. With su = sv = 1 it is exactly `snapToOrtho`.
 */
export function snapToOrthoFine(a: readonly [number, number], p: readonly [number, number], su: 1 | 2, sv: 1 | 2): [number, number] {
  const du = (p[0] - a[0]) / su
  const dv = (p[1] - a[1]) / sv
  const step = Math.PI / 4
  const snapped = Math.round(Math.atan2(dv, du) / step) * step
  const dist = Math.hypot(du, dv)
  return [Math.round(a[0] + Math.cos(snapped) * dist * su), Math.round(a[1] + Math.sin(snapped) * dist * sv)]
}

/**
 * Zanpo-style dominant-axis line in plane (u,v): from the anchor toward the target along
 * whichever axis travels farther (ties go to u), at the anchor's minor-axis coordinate —
 * anchor-excluded (it was painted by the tap that set it; re-clicking would spin wedges/slabs),
 * endpoint-included. A same-cell anchor/target yields just that cell (a re-tap, with normal
 * re-click semantics). Callers map the cells back with `gridCoordFromPixel` and clip bounds.
 */
export function dominantAxisLine(u0: number, v0: number, u1: number, v1: number): Array<[number, number]> {
  const du = u1 - u0
  const dv = v1 - v0
  if (du === 0 && dv === 0) return [[u1, v1]]
  const cells: Array<[number, number]> = []
  if (Math.abs(du) >= Math.abs(dv)) {
    const step = Math.sign(du)
    for (let i = 1; i <= Math.abs(du); i++) cells.push([u0 + i * step, v0])
  } else {
    const step = Math.sign(dv)
    for (let i = 1; i <= Math.abs(dv); i++) cells.push([u0, v0 + i * step])
  }
  return cells
}

/**
 * `dominantAxisLine` at a grid's resolution: points are fine units (`su`×`sv` per cell) and the
 * dominant axis is the one travelling farther on screen (a fine unit is 1/s of a cell; ties go to
 * u). Anchor-excluded, endpoint-included, like the whole-cell line.
 */
export function dominantAxisLineFine(a: readonly [number, number], b: readonly [number, number], su: 1 | 2, sv: 1 | 2): Array<[number, number]> {
  const du = b[0] - a[0]
  const dv = b[1] - a[1]
  if (du === 0 && dv === 0) return [[b[0], b[1]]]
  const out: Array<[number, number]> = []
  if (Math.abs(du) / su >= Math.abs(dv) / sv) {
    const step = Math.sign(du)
    for (let i = 1; i <= Math.abs(du); i++) out.push([a[0] + i * step, a[1]])
  } else {
    const step = Math.sign(dv)
    for (let i = 1; i <= Math.abs(dv); i++) out.push([a[0], a[1] + i * step])
  }
  return out
}
