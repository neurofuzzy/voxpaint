import { DEFAULT_GRID_EXTENT } from '@/engine/grid/GridStore'
import type { Axis, Orientation } from '@/engine/grid/types'

/**
 * The 6 box-map directions. A box face **is** a construction plane facing outward, so it reuses the
 * same `(axis, orientation)` vocabulary (see `BOX_FACE_AXIS`). `px` = +X face, `nx` = -X, etc.
 */
export type BoxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'

/** Every box face, in a stable order (used for atlas layout, iteration, serialization). */
export const BOX_FACES: readonly BoxFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz']

/** A box face decomposed into its construction-plane axis + outward orientation. */
export const BOX_FACE_AXIS: Record<BoxFace, { axis: Axis; orientation: Orientation }> = {
  px: { axis: 'x', orientation: 1 },
  nx: { axis: 'x', orientation: -1 },
  py: { axis: 'y', orientation: 1 },
  ny: { axis: 'y', orientation: -1 },
  pz: { axis: 'z', orientation: 1 },
  nz: { axis: 'z', orientation: -1 },
}

/** Inverse of `BOX_FACE_AXIS`: pick the box face for an (axis, orientation) pair. */
export function boxFaceOf(axis: Axis, orientation: Orientation): BoxFace {
  if (axis === 'x') return orientation === 1 ? 'px' : 'nx'
  if (axis === 'y') return orientation === 1 ? 'py' : 'ny'
  return orientation === 1 ? 'pz' : 'nz'
}

/** Texels per voxel along each axis — the texture map is 4× the voxel resolution (each texel =
 * 0.25 voxel). */
export const TEXEL_SCALE = 4

/** Texels along one edge of a single box face = grid extent × texel scale (64 at the default 16³
 * working volume). Each face is `FACE_SIZE²` texels. */
export const FACE_SIZE = DEFAULT_GRID_EXTENT * TEXEL_SCALE

/** Half the working volume in world units — the in-plane world coordinate range a face covers is
 * `[-HALF_WORLD, HALF_WORLD)`. */
export const HALF_WORLD = DEFAULT_GRID_EXTENT / 2

/**
 * The texture palette — 8 grayscale values: **4 dark** (indices 0–3) and **4 light** (indices 4–7),
 * evenly spaced across the blend range so none lands on neutral 0.5 (a mid-gray swatch would be a
 * no-op under overlay, so it's deliberately skipped). A texel stores one of these indices, or
 * `EMPTY` when unpainted. The grayscale is applied to the voxel's palette color via **overlay**
 * blend (see `overlay.ts`): darker values darken, lighter values lighten; `EMPTY` is neutral. The
 * hex values are the grays corresponding to each blend level (`index/7`), used for the 2D canvas /
 * swatch display only — the actual surface effect comes from the blend value, not the hex.
 */
export const GRAYSCALE: readonly string[] = ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff']

/** Sentinel stored in a texel array for an unpainted texel. Chosen outside the 0..4 index range and
 * inside `Uint8Array`'s domain. Renders as white (multiply no-op) in the atlas. */
export const EMPTY = 255

/**
 * The box-mapped texture: 6 independent grayscale faces, each a flat `FACE_SIZE²` `Uint8Array` of
 * grayscale indices (0..4) or `EMPTY`. Parallel to `VoxelModel`; treat as immutable outside Immer
 * producers (the store diffs on reference equality).
 */
export type TextureModel = {
  faces: Record<BoxFace, Uint8Array>
}
