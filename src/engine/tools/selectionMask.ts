import { DEFAULT_GRID_EXTENT } from '@/engine/grid/GridStore'
import type { SelectionRegion } from '@/store/types'

/** A selection covering the entire working span — used by the Move tool to shift every pixel
 * visible on the current plane slice, regardless of any existing partial selection. */
export function fullCanvasRegion(): SelectionRegion {
  const half = DEFAULT_GRID_EXTENT / 2
  return {
    originU: -half,
    originV: -half,
    width: DEFAULT_GRID_EXTENT,
    height: DEFAULT_GRID_EXTENT,
    mask: new Uint8Array(DEFAULT_GRID_EXTENT * DEFAULT_GRID_EXTENT).fill(1),
  }
}

export function rectRegion(u0: number, v0: number, u1: number, v1: number): SelectionRegion {
  const originU = Math.min(u0, u1)
  const originV = Math.min(v0, v1)
  const width = Math.abs(u1 - u0) + 1
  const height = Math.abs(v1 - v0) + 1
  const mask = new Uint8Array(width * height).fill(1)
  return { originU, originV, width, height, mask }
}

function pointInPolygon(x: number, y: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/** Builds a selection mask from a freehand (lasso) path via point-in-polygon on cell centers. */
export function lassoRegion(points: ReadonlyArray<readonly [number, number]>): SelectionRegion | null {
  if (points.length < 3) return null

  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const [u, v] of points) {
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }

  const originU = minU
  const originV = minV
  const width = maxU - minU + 1
  const height = maxV - minV + 1
  const mask = new Uint8Array(width * height)

  for (let dv = 0; dv < height; dv++) {
    const cy = originV + dv + 0.5
    for (let du = 0; du < width; du++) {
      const cx = originU + du + 0.5
      if (pointInPolygon(cx, cy, points)) mask[dv * width + du] = 1
    }
  }
  return { originU, originV, width, height, mask }
}

export function isCellSelected(region: SelectionRegion, u: number, v: number): boolean {
  const du = u - region.originU
  const dv = v - region.originV
  if (du < 0 || du >= region.width || dv < 0 || dv >= region.height) return false
  return region.mask[dv * region.width + du] === 1
}

export function forEachSelectedCell(region: SelectionRegion, cb: (u: number, v: number) => void): void {
  for (let dv = 0; dv < region.height; dv++) {
    for (let du = 0; du < region.width; du++) {
      if (region.mask[dv * region.width + du] === 1) cb(region.originU + du, region.originV + dv)
    }
  }
}

/** Rotates a selection mask 90° clockwise in place (origin corner is preserved, extents swap). */
export function rotateRegion90(region: SelectionRegion): SelectionRegion {
  const { width, height, mask, originU, originV } = region
  const newMask = new Uint8Array(width * height)
  for (let dv = 0; dv < height; dv++) {
    for (let du = 0; du < width; du++) {
      if (mask[dv * width + du] !== 1) continue
      const ndu = height - 1 - dv
      const ndv = du
      newMask[ndv * height + ndu] = 1
    }
  }
  return { originU, originV, width: height, height: width, mask: newMask }
}

/** A single boundary edge in grid-corner coordinates: cell (u,v)'s corners are (u,v)..(u+1,v+1). */
export type OutlineEdge = [[number, number], [number, number]]

/**
 * Traces a selection mask's true boundary (handles lasso shapes and holes) as a flat list of unit
 * edges, for marching-ants rendering. Each edge is emitted as its own subpath by the caller —
 * canvas dash patterns restart at each subpath, so per-edge subpaths still pulse in sync (all
 * edges share the same short length relative to the dash period and the same lineDashOffset),
 * without needing to stitch edges into continuous loops.
 */
export function traceSelectionOutline(region: SelectionRegion): OutlineEdge[] {
  const edges: OutlineEdge[] = []
  for (let dv = 0; dv < region.height; dv++) {
    for (let du = 0; du < region.width; du++) {
      if (region.mask[dv * region.width + du] !== 1) continue
      const u = region.originU + du
      const v = region.originV + dv
      if (!isCellSelected(region, u, v - 1)) edges.push([[u, v], [u + 1, v]])
      if (!isCellSelected(region, u, v + 1)) edges.push([[u, v + 1], [u + 1, v + 1]])
      if (!isCellSelected(region, u - 1, v)) edges.push([[u, v], [u, v + 1]])
      if (!isCellSelected(region, u + 1, v)) edges.push([[u + 1, v], [u + 1, v + 1]])
    }
  }
  return edges
}

export function mirrorRegion(region: SelectionRegion, axis: 'horizontal' | 'vertical'): SelectionRegion {
  const { width, height, mask, originU, originV } = region
  const newMask = new Uint8Array(width * height)
  for (let dv = 0; dv < height; dv++) {
    for (let du = 0; du < width; du++) {
      if (mask[dv * width + du] !== 1) continue
      const ndu = axis === 'horizontal' ? width - 1 - du : du
      const ndv = axis === 'vertical' ? height - 1 - dv : dv
      newMask[ndv * width + ndu] = 1
    }
  }
  return { originU, originV, width, height, mask: newMask }
}
