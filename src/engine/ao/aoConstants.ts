import type { AOOptions } from './voxelAO'

/**
 * Central configuration for the ambient-occlusion bake. The falloff/weight values are the solver's
 * tunables (`etc/specs/ambient-occlusion.md` §4); `AO_STRENGTH` is a separate final-blend amount
 * controlling how strongly the baked occlusion darkens the surface (0 = no effect, 1 = full).
 */

/** Depth of the directional search projection, in voxels. Main perf lever (cost ∝ radius³). */
export const AO_SEARCH_RADIUS = 6
/** Clamps the minimum orthogonal delta so sharp corners don't divide toward zero. */
export const AO_EDGE_BIAS = 0.5
/** Weight for shadow bleed/softness across the surface plane. */
export const AO_INDIRECT_FALLOFF = 2
/** Weight for contact darkness directly beneath overhangs. */
export const AO_DIRECT_FALLOFF = 4
/** Global scaler on accumulated occlusion inside the solver, before clamping. */
export const AO_INTENSITY = 1

/** How strongly the baked AO darkens the final surface (applied as a multiply): stored value =
 * `1 − AO_STRENGTH·(1 − ao)`, so 0 leaves the surface untouched and 1 uses the raw occlusion. */
export const AO_STRENGTH = 0.85

/** Whether ambient occlusion is on by default in the 3D viewport. */
export const AO_DEFAULT_ENABLED = false

/** The solver options assembled from the tunable constants above. */
export const AO_OPTIONS: AOOptions = {
  searchRadius: AO_SEARCH_RADIUS,
  edgeBias: AO_EDGE_BIAS,
  indirectFalloff: AO_INDIRECT_FALLOFF,
  directFalloff: AO_DIRECT_FALLOFF,
  intensity: AO_INTENSITY,
}
