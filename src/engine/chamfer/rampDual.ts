import type { Axis, ChamferCell, Coord, Orientation, Rotation } from '@/engine/grid/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { outwardNormal } from '@/engine/plane/planeGeometry'

/**
 * Dual-basis search for prism voxels: finds the rotation that reproduces a ramp or wedge cell's
 * exact world-space solid on a *different* authoring basis, so its box-mapped texture face
 * (`boxFaceForCell`, derived from `planeAxis`/`planeOrientation`) can be switched without
 * touching the geometry, the color, or the data model.
 *
 * Ramps and wedges are congruent solids — both unit right-triangular prisms of volume 1/2, one
 * with its triangle in the u-w plane (extruded along v), the other in the u-v plane (extruded
 * along w) — so a wedge's dual on another basis is a *ramp* (and the search below discovers the
 * pairing instead of hand-tabling it). Corner volumes (convex/concave) and slabs (thin) are not
 * prisms congruent to these and have no exact dual, so they always yield null.
 *
 * Mirror-invariance: on reflected planes (+X/+Z/-Y) rendering pairs a v-mirrored geometry with a
 * negated-V/negated-rotation matrix (`chamferInstanceMatrix`), and those two mirrors cancel
 * (`makeBasis(U,V,W)·Rz(θ) = makeBasis(U,-V,W)·Rz(-θ)·F_v`), so the world solid always equals the
 * *raw* basis times the *plain* rotation-0 corner set. Signatures below therefore use the raw
 * basis directly and never need the mirrored variant.
 */

// Occupied local-prefab corners of a rotation-0 ramp: the full base quad (z=-0.5) plus the top
// edge on the west (u=-0.5) side — the knife edge is east. Same corner order as chamferGeometry.
const RAMP_LOCAL_CORNERS: Coord[] = [
  [0.5, -0.5, -0.5], // b0 NE base
  [0.5, 0.5, -0.5], // b1 SE base
  [-0.5, 0.5, -0.5], // b2 SW base
  [-0.5, -0.5, -0.5], // b3 NW base
  [-0.5, 0.5, 0.5], // t2 SW top
  [-0.5, -0.5, 0.5], // t3 NW top
]

// Occupied local-prefab corners of a rotation-0 wedge: every corner except the NE vertical edge
// (base b0 + top t0) — the diagonal cut removes that column entirely, top and bottom.
const WEDGE_LOCAL_CORNERS: Coord[] = [
  [0.5, 0.5, -0.5], // b1 SE base
  [-0.5, 0.5, -0.5], // b2 SW base
  [-0.5, -0.5, -0.5], // b3 NW base
  [0.5, 0.5, 0.5], // t1 SE top
  [-0.5, 0.5, 0.5], // t2 SW top
  [-0.5, -0.5, 0.5], // t3 NW top
]

/** Plain rotation about the prefab's own up (outward) axis — matches THREE's `rotateZ`. */
function rotateLocal([u, v, w]: Coord, rotation: Rotation): Coord {
  switch (rotation) {
    case 0:
      return [u, v, w]
    case 1:
      return [-v, u, w]
    case 2:
      return [-u, -v, w]
    case 3:
      return [v, -u, w]
  }
}

/**
 * Translation-invariant signature of a prism solid on the given authoring basis: the rotated
 * corner set mapped through the plane's world (U, V, outward) basis, quantized ×2 (all
 * components are exact half-integers, so the keys are exact integers). The cell-center
 * translation is deliberately omitted — source and target share the cell, so it cancels.
 */
function prismSignature(axis: Axis, orientation: Orientation, rotation: Rotation, corners: Coord[]): string {
  const { uDir, vDir } = planeLogicalBasis(axis)
  const W = outwardNormal(axis, orientation)
  const keys = corners.map((corner) => {
    const [u, v, w] = rotateLocal(corner, rotation)
    const x = u * uDir[0] + v * vDir[0] + w * W[0]
    const y = u * uDir[1] + v * vDir[1] + w * W[1]
    const z = u * uDir[2] + v * vDir[2] + w * W[2]
    return `${x * 2},${y * 2},${z * 2}`
  })
  return keys.sort().join(';')
}

/** Ramp solid signature — the search space for both ramp and wedge sources is ramp targets. */
function rampSignature(axis: Axis, orientation: Orientation, rotation: Rotation): string {
  return prismSignature(axis, orientation, rotation, RAMP_LOCAL_CORNERS)
}

/**
 * The rotation that reproduces `cell`'s solid on (`targetAxis`, `targetOrientation`), or null
 * when the cell isn't a resolved ramp or no rotation there matches (a different shape kind, an
 * unresolved cell, or a basis that can't express this solid). Returning the cell's own rotation
 * when the target equals its current basis is the idempotent no-op — callers must treat that as
 * "already there", not a write.
 */
export function findDualRampRotation(
  cell: ChamferCell,
  targetAxis: Axis,
  targetOrientation: Orientation,
): Rotation | null {
  const resolved = cell.resolvedTo
  if (!resolved || resolved.shapeKind !== 'ramp') return null
  const source = rampSignature(cell.planeAxis, cell.planeOrientation, resolved.rotation)
  const rotations: Rotation[] = [0, 1, 2, 3]
  for (const r of rotations) {
    if (rampSignature(targetAxis, targetOrientation, r) === source) return r
  }
  return null
}

/**
 * The ramp rotation that reproduces a *wedge* cell's solid on (`targetAxis`,
 * `targetOrientation`), or null when the cell isn't a resolved wedge or no ramp there matches.
 * A wedge already authored on the target basis always yields null — its texture face is already
 * correct, and same-basis wedge→ramp congruence is impossible (a ramp on a basis never extrudes
 * along that basis's outward axis, which is exactly what the wedge extrudes along).
 */
export function findWedgeRampDual(
  cell: ChamferCell,
  targetAxis: Axis,
  targetOrientation: Orientation,
): Rotation | null {
  const resolved = cell.resolvedTo
  if (!resolved || resolved.shapeKind !== 'wedge') return null
  const source = prismSignature(cell.planeAxis, cell.planeOrientation, resolved.rotation, WEDGE_LOCAL_CORNERS)
  const rotations: Rotation[] = [0, 1, 2, 3]
  for (const r of rotations) {
    if (rampSignature(targetAxis, targetOrientation, r) === source) return r
  }
  return null
}
