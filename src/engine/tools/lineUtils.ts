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
