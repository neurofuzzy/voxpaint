/**
 * Analytical volumetric voxel ambient-occlusion solver — a pure, renderer-agnostic port of
 * `etc/specs/ambient-occlusion.md`. Rather than a physically-based occlusion integral, it projects a
 * directional search "cone" along each sample point's dominant face normal and accumulates a stylized
 * proximity falloff from the voxel clusters in front of it, producing deep, tunable gradient contact
 * shadows. The output is a normalized scalar per sample (0 = fully occluded/dark, 1 = fully lit).
 *
 * The falloff formula and `1/(dist+ε)` accumulation follow the spec's §6 example code (all six axis
 * cases implemented here, not just the four the example ships). Note the spec's §2 math also shows a
 * trailing `× 2.0` the example code omits; we follow the example and let `intensity` absorb the
 * overall scale. The distance expression is deliberately dimensionally loose — it is a stylized
 * gradient, not a metric distance.
 *
 * Sample points come from either mesh vertices+normals (vertex baking) or texel→world positions
 * (canvas/atlas baking); `cubes` are the occupied voxel coordinates (`decodeKey` over `model.color`).
 */

export type Vec3 = { x: number; y: number; z: number }

export type AOSamplePoint = {
  /** Surface position of the sample in voxel/world space. */
  position: Vec3
  /** Surface normal; its dominant component selects the search axis (routing per spec §3). */
  normal: Vec3
}

export type AOOptions = {
  /** Depth of the directional search projection along the face normal. Larger = bigger shadows. */
  searchRadius?: number
  /** Clamps the minimum orthogonal delta so sharp corners don't divide toward zero. */
  edgeBias?: number
  /** Weight for shadow bleed/softness across the surface plane. */
  indirectFalloff?: number
  /** Weight for contact darkness directly beneath overhangs. */
  directFalloff?: number
  /** Global scaler on the accumulated occlusion before clamping. */
  intensity?: number
}

export const DEFAULT_AO_OPTIONS: Required<AOOptions> = {
  searchRadius: 7,
  edgeBias: 0.5,
  indirectFalloff: 2,
  directFalloff: 4,
  intensity: 1,
}

type Axis3 = 'x' | 'y' | 'z'

/** The two axes orthogonal to each dominant axis (the "indirect" tracking plane). */
const ORTHOGONAL: Record<Axis3, [Axis3, Axis3]> = {
  x: ['y', 'z'],
  y: ['x', 'z'],
  z: ['x', 'y'],
}

/**
 * Dominant-axis routing (spec §3): the largest absolute normal component picks the axis, its sign
 * picks the facing. Ties resolve toward `z` (top/bottom), matching the spec's `else` branch.
 */
function dominantAxis(n: Vec3): { axis: Axis3; positive: boolean } {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  if (ax > ay && ax > az) return { axis: 'x', positive: n.x > 0 }
  if (ay > ax && ay > az) return { axis: 'y', positive: n.y > 0 }
  return { axis: 'z', positive: n.z > 0 }
}

/**
 * Computes analytical voxel-based ambient occlusion for a collection of sample points, testing each
 * against the occluding voxel set. Returns normalized AO (0 = dark, 1 = bright), one per sample.
 *
 * Complexity is kept near O(samples · local) rather than O(samples · cubes) by rejecting, per sample,
 * any voxel that sits behind the sample's face plane, beyond `searchRadius` along the face normal, or
 * outside `searchRadius` in the orthogonal plane (the spec's "tight bounding spatial cuts").
 */
export function computeVoxelAO(samplePoints: AOSamplePoint[], cubes: Vec3[], options: AOOptions = {}): Float32Array {
  const { searchRadius, edgeBias, indirectFalloff, directFalloff, intensity } = { ...DEFAULT_AO_OPTIONS, ...options }
  const activeCubes = cubes.filter((c): c is Vec3 => !!c)
  const results = new Float32Array(samplePoints.length)

  for (let i = 0; i < samplePoints.length; i++) {
    const { position: p, normal: n } = samplePoints[i]
    const { axis, positive } = dominantAxis(n)
    const [ia, ib] = ORTHOGONAL[axis]

    let totalShadow = 0
    for (const c of activeCubes) {
      // Directional (direct) component: signed positive distance in front of the sample plane.
      const dir = positive ? c[axis] - p[axis] : p[axis] - c[axis]
      if (dir <= 0 || dir > searchRadius) continue // behind the plane or beyond the search cone

      const da = c[ia] - p[ia]
      const db = c[ib] - p[ib]
      if (Math.abs(da) > searchRadius || Math.abs(db) > searchRadius) continue // outside the plane bounds

      const indA = Math.max(edgeBias, da * da)
      const indB = Math.max(edgeBias, db * db)
      const dist = Math.sqrt(indA * dir * indirectFalloff + indB * dir * indirectFalloff + dir * dir * directFalloff)
      totalShadow += 1 / (dist + 0.001)
    }

    const aoFactor = 1 - totalShadow * intensity
    results[i] = Math.max(0, Math.min(1, aoFactor))
  }

  return results
}
