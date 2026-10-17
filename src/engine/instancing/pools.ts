import * as THREE from 'three'
import type { ChamferCell } from '@/engine/grid/types'
import { concaveCornerGeometry, convexCornerGeometry, halfGeometry, mirrorVGeometry, postGeometry, quarterGeometry, rampGeometry, thinGeometry, unitCubeGeometry, wedgeGeometry } from '@/engine/chamfer/chamferGeometry'
import { chamferBasisIsReflected } from './basis'

/**
 * The instancing pools every voxel render path draws from — the live `InstancingManager` and the
 * floating-selection ghost (`FloatGhostPreview.tsx`) alike, so a float and the model it bakes into
 * can't disagree about what a cell's shape is.
 *
 * Chamfer shapes split into a plain and a v-mirrored (`…M`) pool: reflected-basis planes (+Z/+X/-Y)
 * use the mirrored geometry so every rendered instance stays a proper rotation and lights
 * correctly. See basis.ts's `chamferBasisIsReflected` and chamferGeometry.ts's `mirrorVGeometry`.
 */
export type PoolId = 'cube' | 'ramp' | 'convex' | 'concave' | 'wedge' | 'thin' | 'half' | 'post' | 'quarter' | 'rampM' | 'convexM' | 'concaveM' | 'wedgeM' | 'thinM' | 'halfM' | 'postM' | 'quarterM'

export const POOL_IDS: PoolId[] = ['cube', 'ramp', 'convex', 'concave', 'wedge', 'thin', 'half', 'post', 'quarter', 'rampM', 'convexM', 'concaveM', 'wedgeM', 'thinM', 'halfM', 'postM', 'quarterM']

/** The pool a color cell belongs to, accounting for its baked shape and plane handedness. */
export function poolIdFor(chamfer: ChamferCell | undefined): PoolId {
  if (!chamfer?.resolvedTo) return 'cube'
  const kind = chamfer.resolvedTo.shapeKind
  return chamferBasisIsReflected(chamfer.planeAxis, chamfer.planeOrientation) ? (`${kind}M` as PoolId) : kind
}

/**
 * One fresh geometry per pool. Callers own what they get back and must dispose it — geometries are
 * not shared between callers, since three.js disposal is by-instance.
 */
export function buildPoolGeometries(): Record<PoolId, THREE.BufferGeometry> {
  const ramp = rampGeometry(0)
  const convex = convexCornerGeometry(0)
  const concave = concaveCornerGeometry(0)
  const wedge = wedgeGeometry(0)
  const thin = thinGeometry()
  const half = halfGeometry()
  const post = postGeometry()
  const quarter = quarterGeometry(0)
  return {
    cube: unitCubeGeometry(),
    ramp,
    convex,
    concave,
    wedge,
    thin,
    half,
    post,
    quarter,
    rampM: mirrorVGeometry(ramp),
    convexM: mirrorVGeometry(convex),
    concaveM: mirrorVGeometry(concave),
    wedgeM: mirrorVGeometry(wedge),
    // Symmetric slab: mirrorV is the same shape, but keeps reflected-plane instances det=+1 and
    // correctly lit on the same path as the chamfer pools.
    thinM: mirrorVGeometry(thin),
    // Flush-outward slab, mirrored across v like the other M pools: the slab stays on the
    // outward half (mirroring never moves it across halves), keeping reflected-plane instances
    // det=+1. The inward half renders from the same geometry via a flipped authoring orientation.
    halfM: mirrorVGeometry(half),
    // Centered column: mirrorV is the same solid, keeping reflected-plane instances det=+1.
    postM: mirrorVGeometry(post),
    // Corner column: mirroring across v moves NE to SE (like the wedge's cut corner), and the
    // reflected-plane matrix's negated rotation moves it back — same scheme as the bevel pools.
    quarterM: mirrorVGeometry(quarter),
  }
}
