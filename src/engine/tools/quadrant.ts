import { boxDisplayRect, type CellBox } from '@/engine/grid/cellBox'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import type { ConstructionPlane } from '@/engine/plane/types'

/**
 * Which 2×2 quadrant of a cell the pointer is in, in raw display space (no mirroring).
 * Feed the result through the plane mirrors for the logical quadrant (see below), or draw
 * it directly for display-space overlays like the hover outline.
 * Returns null when the event carries no continuous position (synthetic events).
 */
export function displayQuadrantFromFractions(
  cu: number | undefined,
  cv: number | undefined,
): [number, number] | null {
  if (cu === undefined || cv === undefined) return null
  const fu = cu - Math.floor(cu)
  const fv = cv - Math.floor(cv)
  return [fu >= 0.5 ? 1 : 0, fv >= 0.5 ? 1 : 0]
}

/** Whether the plane's display flips logical u / v (the involutory mirrors `pixelToCell` applies). */
export function planeMirrors(plane: ConstructionPlane): { mirrorsU: boolean; mirrorsV: boolean } {
  return { mirrorsU: toDisplayU(plane, 0) !== 0, mirrorsV: toDisplayV(plane, 0) !== 0 }
}

/** Display quadrant → logical quadrant (the mirrors are involutions, so this also inverts). */
export function logicalQuadrant(plane: ConstructionPlane, q: [number, number]): [number, number] {
  const { mirrorsU, mirrorsV } = planeMirrors(plane)
  return [mirrorsU ? 1 - q[0] : q[0], mirrorsV ? 1 - q[1] : q[1]]
}

/**
 * Display quadrant mapped into the logical (u,v) frame via the plane's involutory mirrors —
 * the same conversion `pixelToCell` applies, so the quadrant agrees with the painted cell
 * on every plane orientation.
 */
export function quadrantFromFractions(
  plane: ConstructionPlane,
  cu: number | undefined,
  cv: number | undefined,
): [number, number] | null {
  const q = displayQuadrantFromFractions(cu, cv)
  return q ? logicalQuadrant(plane, q) : null
}

/** Display-space footprint of a box on `plane` (fractions of the cell) — what a 2D tap there
 * writes, for the hover outline. */
export function boxDisplayFootprint(plane: ConstructionPlane, box: CellBox): [u0: number, v0: number, u1: number, v1: number] {
  const { mirrorsU, mirrorsV } = planeMirrors(plane)
  return boxDisplayRect(plane, box, mirrorsU, mirrorsV)
}
