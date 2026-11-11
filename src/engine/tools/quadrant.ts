import { childInSlab, frontSlabBit, quadrantSubcells, splitChildBits, subdivChildFootprint } from '@/engine/grid/subdiv'
import type { SplitAxis } from '@/engine/grid/types'
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
  if (!q) return null
  const mirrorsU = toDisplayU(plane, 0) !== 0
  const mirrorsV = toDisplayV(plane, 0) !== 0
  return [mirrorsU ? 1 - q[0] : q[0], mirrorsV ? 1 - q[1] : q[1]]
}

/**
 * Display-space footprint of the detail a 2D tap on display quadrant (`dqu`, `dqv`) would
 * hit: a half for single-axis splits, the full cell for depth-only splits, a quarter for
 * 8-splits. Composes unmirror → `quadrantSubcells` → logical footprint → mirror back, so
 * the highlight covers exactly the painted mini-cells on every plane orientation. Hover
 * overlays must use this, never the raw logical footprint — mirrored planes (e.g. XZ
 * with Y up) would otherwise highlight the wrong half while painting stays correct.
 */
export function subdivDisplayFootprint(
  plane: ConstructionPlane,
  split: SplitAxis[],
  dqu: number,
  dqv: number,
): [u0: number, v0: number, u1: number, v1: number] {
  const mirrorsU = toDisplayU(plane, 0) !== 0
  const mirrorsV = toDisplayV(plane, 0) !== 0
  const set = quadrantSubcells(
    plane.axis, plane.orientation, split,
    mirrorsU ? 1 - dqu : dqu,
    mirrorsV ? 1 - dqv : dqv,
  )
  // On a half-voxel stop only the plane's slab is editable: the footprint is that slab's child.
  const slab = plane.half ?? frontSlabBit(plane.orientation)
  const idx = set.find((i) => childInSlab(split, plane.axis, slab, i)) ?? set[0] ?? 0
  const [fu0, fv0, fu1, fv1] = subdivChildFootprint(plane.axis, split, idx)
  return [
    mirrorsU ? 1 - fu1 : fu0,
    mirrorsV ? 1 - fv1 : fv0,
    mirrorsU ? 1 - fu0 : fu1,
    mirrorsV ? 1 - fv0 : fv1,
  ]
}

/**
 * The world-axis halves (0/1 per axis) of the child a display-space hover quadrant addresses on
 * `plane`, restricted to the plane's editable slab (`plane.half`, else the viewer-side slab) — the
 * same mirror handling as `subdivDisplayFootprint`, but as bits, so the 3D ghost can show the
 * sub-voxel the 2D hover is over.
 */
export function subdivDisplayBits(
  plane: ConstructionPlane,
  split: SplitAxis[],
  dqu: number,
  dqv: number,
): [number, number, number] {
  const mirrorsU = toDisplayU(plane, 0) !== 0
  const mirrorsV = toDisplayV(plane, 0) !== 0
  const set = quadrantSubcells(
    plane.axis, plane.orientation, split,
    mirrorsU ? 1 - dqu : dqu,
    mirrorsV ? 1 - dqv : dqv,
  )
  const slab = plane.half ?? frontSlabBit(plane.orientation)
  const idx = set.find((i) => childInSlab(split, plane.axis, slab, i)) ?? set[0] ?? 0
  return splitChildBits(split, idx)
}
