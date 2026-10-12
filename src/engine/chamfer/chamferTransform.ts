import type { Axis, ChamferCell, ChamferShapeKind, Coord, Orientation, Rotation } from '@/engine/grid/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { ALL_AXES, outwardNormal } from '@/engine/plane/planeGeometry'
import { RAMP_LOCAL_CORNERS, WEDGE_LOCAL_CORNERS, rotateLocal } from './rampDual'

/**
 * Rigid-motion mapping for chamfer cells under whole-model / float rotate and mirror.
 *
 * `rotateClassification90` / `mirrorClassification` (engine/tools/transform.ts) renumber a shape
 * as if it were authored in the rotation plane's own frame — correct only when the cell's baked
 * `planeAxis` matches that plane. A bevel baked on another axis points out of the rotation plane
 * entirely, so turning the model must also move its authoring basis (and renumber the shape in
 * the new frame), or the bevel keeps pointing the old way while its voxels move.
 *
 * This module maps solids exactly instead: every shape's world-space solid is identified by its
 * occupied prefab-corner set (the same convention `rampDual.ts`'s dual search uses — corners are
 * exact half-integers, so signatures are exact integers), the rigid motion permutes those corners,
 * and the result is looked up among the same shape's (axis, orientation, rotation) candidates.
 * Same-axis cells always resolve back onto their own basis with the legacy renumbering, so the
 * previously-working case is behavior-identical — only cross-axis cells change (from wrong to
 * right). Unresolved cells and thin slabs (whose corners don't pin a solid — the slab is centered)
 * only get their authoring basis moved, never a shape.
 */

// Occupied local-prefab corners of a rotation-0 convex corner: the full base quad plus the single
// top vertex above SW — the hip roof's high corner (see convexCornerGeometry, canonical SW).
const CONVEX_LOCAL_CORNERS: Coord[] = [
  [0.5, -0.5, -0.5], // b0 NE base
  [0.5, 0.5, -0.5], // b1 SE base
  [-0.5, 0.5, -0.5], // b2 SW base
  [-0.5, -0.5, -0.5], // b3 NW base
  [-0.5, 0.5, 0.5], // t2 SW top
]

// Occupied local-prefab corners of a rotation-0 concave corner: the full base quad plus every top
// vertex except the notched NE corner (see concaveCornerGeometry, canonical NE notch).
const CONCAVE_LOCAL_CORNERS: Coord[] = [
  [0.5, -0.5, -0.5], // b0 NE base
  [0.5, 0.5, -0.5], // b1 SE base
  [-0.5, 0.5, -0.5], // b2 SW base
  [-0.5, -0.5, -0.5], // b3 NW base
  [0.5, 0.5, 0.5], // t1 SE top
  [-0.5, 0.5, 0.5], // t2 SW top
  [-0.5, -0.5, 0.5], // t3 NW top
]

const SHAPE_CORNERS: Record<Exclude<ChamferShapeKind, 'thin'>, Coord[]> = {
  ramp: RAMP_LOCAL_CORNERS,
  wedge: WEDGE_LOCAL_CORNERS,
  convex: CONVEX_LOCAL_CORNERS,
  concave: CONCAVE_LOCAL_CORNERS,
}

/** World-space (cell-relative, translation-free) occupied corners. Pure geometry truth, memoized. */
const cornersMemo = new Map<string, Coord[]>()
function solidCorners(shape: Exclude<ChamferShapeKind, 'thin'>, axis: Axis, orientation: Orientation, rotation: Rotation): Coord[] {
  const key = `${shape}|${axis}|${orientation}|${rotation}`
  const hit = cornersMemo.get(key)
  if (hit) return hit
  const { uDir: U, vDir: V } = planeLogicalBasis(axis)
  const W = outwardNormal(axis, orientation)
  const corners = SHAPE_CORNERS[shape].map((corner) => {
    const [u, v, w] = rotateLocal(corner, rotation)
    return [
      u * U[0] + v * V[0] + w * W[0],
      u * U[1] + v * V[1] + w * W[1],
      u * U[2] + v * V[2] + w * W[2],
    ] as Coord
  })
  cornersMemo.set(key, corners)
  return corners
}

const cornerKey = (c: Coord): string => `${c[0] * 2},${c[1] * 2},${c[2] * 2}`
const signatureOf = (corners: Coord[]): string => corners.map(cornerKey).sort().join(';')

type RigidMap = (v: Coord) => Coord

/**
 * The linear map sending basis vectors U,V,W to iU,iV,iW. All six are signed unit axes here
 * (plane logical frames and their images under quarter-turns/mirrors), so this is exact integer
 * arithmetic — no float drift.
 */
function linearMap(U: Coord, V: Coord, W: Coord, iU: Coord, iV: Coord, iW: Coord): RigidMap {
  const from = [U, V, W]
  const to = [iU, iV, iW]
  return ([x, y, z]) => {
    const input = [x, y, z]
    const out: [number, number, number] = [0, 0, 0]
    for (let b = 0; b < 3; b++) {
      const B = from[b]
      const j = B[0] !== 0 ? 0 : B[1] !== 0 ? 1 : 2
      const comp = B[j] * input[j] // B[j] is ±1: the input's component along B
      out[0] += comp * to[b][0]
      out[1] += comp * to[b][1]
      out[2] += comp * to[b][2]
    }
    return out
  }
}

/** Rigid motion for an in-plane turn/mirror, from the logical-frame operation to world images. */
function planeMotion(planeAxis: Axis, op: { kind: 'rotate'; direction: 'cw' | 'ccw' } | { kind: 'mirror'; mirrorU: boolean; mirrorV: boolean }): RigidMap {
  const { uDir: U, vDir: V } = planeLogicalBasis(planeAxis)
  // Either outward sign defines the same map (W → W either way); +1 is arbitrary.
  const W = outwardNormal(planeAxis, 1)
  const neg = (v: Coord): Coord => [-v[0], -v[1], -v[2]]
  if (op.kind === 'rotate') {
    // Matches rotateClipboard90's position mapping: cw sends (cu,cv) -> (-cv,cu), i.e. U→V, V→−U.
    return op.direction === 'cw' ? linearMap(U, V, W, V, neg(U), W) : linearMap(U, V, W, neg(V), U, W)
  }
  return linearMap(U, V, W, op.mirrorU ? neg(U) : U, op.mirrorV ? neg(V) : V, W)
}

/** The authoring basis that tracks the motion: the face the bevel was baked from moves with it,
 * so box-mapped texture faces stay glued to their bevels. Quarter-turns and mirrors permute
 * signed unit axes, so this is always exact. */
function trackedBasis(cell: ChamferCell, T: RigidMap): [Axis, Orientation] {
  const m = T(outwardNormal(cell.planeAxis, cell.planeOrientation))
  const j = m[0] !== 0 ? 0 : m[1] !== 0 ? 1 : 2
  return [ALL_AXES[j], (m[j] > 0 ? 1 : -1) as Orientation]
}

/**
 * Maps one chamfer cell through a rigid motion: resolved shapes are looked up by transformed
 * solid on the tracked basis (same-axis cells land back on their own basis with the legacy
 * renumbering; cross-axis bevels re-base onto whichever axis their solid turns into), while
 * unresolved cells and thin slabs only ride their basis along. The tracked basis always carries
 * the same normal the rotated solid does, and the in-plane frame difference is a whole number
 * of quarter-turns — so exactly one of the four rotations matches. The defensive fallback (no
 * candidate matches — geometry truth changed under us) keeps the cell frozen rather than
 * corrupting it.
 */
function applyMotion(cell: ChamferCell, T: RigidMap): ChamferCell {
  const resolved = cell.resolvedTo
  const [ax, o] = trackedBasis(cell, T)
  if (!resolved || resolved.shapeKind === 'thin') {
    return { planeAxis: ax, planeOrientation: o, resolvedTo: resolved ? { ...resolved } : null }
  }

  const shape = resolved.shapeKind
  const sourceSig = signatureOf(solidCorners(shape, cell.planeAxis, cell.planeOrientation, resolved.rotation).map(T))
  const rotations: Rotation[] = [0, 1, 2, 3]
  for (const r of rotations) {
    if (signatureOf(solidCorners(shape, ax, o, r)) === sourceSig) {
      return { planeAxis: ax, planeOrientation: o, resolvedTo: { shapeKind: shape, rotation: r } }
    }
  }
  return { planeAxis: cell.planeAxis, planeOrientation: cell.planeOrientation, resolvedTo: { ...resolved } }
}

/**
 * Rotates one chamfer cell with a 90° model turn in `planeAxis`'s logical frame (the frame
 * `rotateClipboard90` permutes positions in). Same-axis cells renumber in place; cross-axis
 * bevels re-base onto the axis their solid turns into.
 */
export function rotateChamferCell(cell: ChamferCell, planeAxis: Axis, direction: 'cw' | 'ccw'): ChamferCell {
  return applyMotion(cell, planeMotion(planeAxis, { kind: 'rotate', direction }))
}

/**
 * Mirrors one chamfer cell with an in-plane model mirror (`mirrorU` negates the plane's logical
 * u, `mirrorV` its v — the same flags `mirrorClassification` takes).
 */
export function mirrorChamferCell(cell: ChamferCell, planeAxis: Axis, mirrorU: boolean, mirrorV: boolean): ChamferCell {
  return applyMotion(cell, planeMotion(planeAxis, { kind: 'mirror', mirrorU, mirrorV }))
}
