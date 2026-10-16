import type { GridExtent } from '@/engine/grid/types'
import { effectiveExtent } from '@/engine/grid/GridStore'
import { texelCenterToWorld, worldToTexel } from './boxMapping'
import type { BoxFace, TextureModel } from './types'
import { BOX_FACES, EMPTY, TEXEL_SCALE, faceSizeFor } from './types'
import type { TexelScale } from './types'

/** Sanitizes a stored texel scale (e.g. from a hand-edited file) to the supported 1/2/4 set. */
export function normalizeTexelScale(v: number): TexelScale {
  return v === 1 || v === 2 || v === 4 ? v : TEXEL_SCALE as TexelScale
}

/** Flat index into a face's texel array for texel (u, v). No bounds checking. `faceSize` is the
 * project's own `faceSizeFor(gridExtent)`. */
export function texelIndex(u: number, v: number, faceSize: number): number {
  return v * faceSize + u
}

/** True when (u, v) is inside a face's `faceSize²` bounds. */
export function withinFace(u: number, v: number, faceSize: number): boolean {
  return u >= 0 && u < faceSize && v >= 0 && v < faceSize
}

/** A fresh texture with all six faces unpainted (`EMPTY`), sized for the project's
 * `gridExtent` and texel scale. */
export function emptyTextureModel(gridExtent: GridExtent, texelScale: number = TEXEL_SCALE): TextureModel {
  const faceSize = faceSizeFor(gridExtent, texelScale)
  const faces = {} as Record<BoxFace, Uint8Array>
  for (const face of BOX_FACES) {
    const arr = new Uint8Array(faceSize * faceSize)
    arr.fill(EMPTY)
    faces[face] = arr
  }
  return { faces }
}

/**
 * Re-houses a texture's six faces for a new project size, preserving paint by world position: a
 * texel's world coordinate is `(t + 0.5) / TEXEL_SCALE - halfWorld`, and both half-worlds are
 * integers (the effective grid is always even), so the remap is an exact integer texel shift — a
 * centered crop when shrinking, centered padding (`EMPTY`) when growing. No resampling, no
 * blur. Used by project resize; the voxel model itself is clipped separately. */
export function resizeTextureModel(
  texture: TextureModel,
  oldExtent: GridExtent,
  newExtent: GridExtent,
  texelScale: number = TEXEL_SCALE,
): TextureModel {
  const oldFaceSize = faceSizeFor(oldExtent, texelScale)
  const newFaceSize = faceSizeFor(newExtent, texelScale)
  if (oldFaceSize === newFaceSize) return cloneTextureModel(texture)
  const shift = (effectiveExtent(newExtent) / 2 - effectiveExtent(oldExtent) / 2) * texelScale
  const faces = {} as Record<BoxFace, Uint8Array>
  for (const face of BOX_FACES) {
    const src = texture.faces[face]
    const dst = new Uint8Array(newFaceSize * newFaceSize)
    dst.fill(EMPTY)
    for (let tv = 0; tv < newFaceSize; tv++) {
      const sv = tv - shift
      if (sv < 0 || sv >= oldFaceSize) continue
      for (let tu = 0; tu < newFaceSize; tu++) {
        const su = tu - shift
        if (su < 0 || su >= oldFaceSize) continue
        dst[tv * newFaceSize + tu] = src[sv * oldFaceSize + su]
      }
    }
    faces[face] = dst
  }
  return { faces }
}

/**
 * Re-houses a texture's six faces at a new texels-per-voxel scale, preserving paint by world
 * position with nearest-neighbor sampling — upscale repeats source texels into chunky blocks,
 * downscale center-samples each block. No blur, no blending (`EMPTY` included: a block sampled
 * from an unpainted texel stays unpainted). Used when the project's texel scale changes; the
 * grid extent is untouched, so unlike `resizeTextureModel` there is no crop/pad shift.
 */
export function resampleTextureModel(
  texture: TextureModel,
  gridExtent: GridExtent,
  oldScale: number,
  newScale: number,
): TextureModel {
  const oldFaceSize = faceSizeFor(gridExtent, oldScale)
  const newFaceSize = faceSizeFor(gridExtent, newScale)
  if (oldFaceSize === newFaceSize) return cloneTextureModel(texture)
  const ratio = oldScale / newScale
  const faces = {} as Record<BoxFace, Uint8Array>
  for (const face of BOX_FACES) {
    const src = texture.faces[face]
    const dst = new Uint8Array(newFaceSize * newFaceSize)
    for (let tv = 0; tv < newFaceSize; tv++) {
      // World-anchored: dst center (tv+0.5)/newS maps to the src texel containing that point.
      const sv = Math.min(oldFaceSize - 1, Math.floor((tv + 0.5) * ratio))
      for (let tu = 0; tu < newFaceSize; tu++) {
        const su = Math.min(oldFaceSize - 1, Math.floor((tu + 0.5) * ratio))
        dst[tv * newFaceSize + tu] = src[sv * oldFaceSize + su]
      }
    }
    faces[face] = dst
  }
  return { faces }
}

/**
 * Doubles a texture's six faces for a 2x project rescale, preserving paint glued to the voxels:
 * each new texel samples the old texel under half its world position (the model doubles about
 * the origin, so new-world `w` shows what old-world `w/2` showed). Nearest-neighbor, so
 * grayscale indices (and `EMPTY` holes) duplicate into exact 2×2 blocks on even grids; on odd
 * grids the same world-anchored math keeps everything centered. Used by rescale; the voxel
 * model itself is decomposed separately. All coordinates stay on exact binary fractions
 * (halves/quarters), so the `Math.floor` boundaries below never wobble — no epsilon.
 */
export function rescaleTextureModel2x(
  texture: TextureModel,
  oldExtent: GridExtent,
  newExtent: GridExtent,
  texelScale: number = TEXEL_SCALE,
): TextureModel {
  const newFaceSize = faceSizeFor(newExtent, texelScale)
  const oldFaceSize = faceSizeFor(oldExtent, texelScale)
  const faces = {} as Record<BoxFace, Uint8Array>
  for (const face of BOX_FACES) {
    const src = texture.faces[face]
    const dst = new Uint8Array(newFaceSize * newFaceSize)
    dst.fill(EMPTY)
    for (let tv = 0; tv < newFaceSize; tv++) {
      for (let tu = 0; tu < newFaceSize; tu++) {
        // World center of the new texel (depth coordinate is irrelevant — worldToTexel only
        // reads the in-plane components), halved back into the old model's frame.
        const [x, y, z] = texelCenterToWorld(face, tu, tv, 0, newExtent, texelScale)
        const [su, sv] = worldToTexel(face, x / 2, y / 2, z / 2, oldExtent, texelScale)
        const ou = Math.floor(su)
        const ov = Math.floor(sv)
        if (!withinFace(ou, ov, oldFaceSize)) continue
        dst[tv * newFaceSize + tu] = src[texelIndex(ou, ov, oldFaceSize)]
      }
    }
    faces[face] = dst
  }
  return { faces }
}

/** Reads a texel's grayscale index (or `EMPTY`). Out-of-bounds reads return `EMPTY`. */
export function getTexel(texture: TextureModel, face: BoxFace, u: number, v: number, faceSize: number): number {
  if (!withinFace(u, v, faceSize)) return EMPTY
  return texture.faces[face][texelIndex(u, v, faceSize)]
}

/** True when any texel on any face has been painted (used to skip empty textures on export). */
export function hasTextureContent(texture: TextureModel): boolean {
  for (const face of BOX_FACES) {
    const arr = texture.faces[face]
    for (let i = 0; i < arr.length; i++) if (arr[i] !== EMPTY) return true
  }
  return false
}

/**
 * Shallow-clones a texture, deep-copying only the given face's array (copy-on-write). Used by the
 * texel producers so a stroke's snapshot and the live model never share a face buffer. Pass no face
 * to deep-copy every face (used by history baselines / float lifts).
 */
export function cloneTextureModel(texture: TextureModel, face?: BoxFace): TextureModel {
  const faces = {} as Record<BoxFace, Uint8Array>
  for (const f of BOX_FACES) {
    faces[f] = face === undefined || f === face ? new Uint8Array(texture.faces[f]) : texture.faces[f]
  }
  return { faces }
}
