import type { BoxFace, TextureModel } from './types'
import { BOX_FACES, EMPTY, FACE_SIZE } from './types'

/** Flat index into a face's texel array for texel (u, v). No bounds checking. */
export function texelIndex(u: number, v: number): number {
  return v * FACE_SIZE + u
}

/** True when (u, v) is inside a face's `FACE_SIZE²` bounds. */
export function withinFace(u: number, v: number): boolean {
  return u >= 0 && u < FACE_SIZE && v >= 0 && v < FACE_SIZE
}

/** A fresh texture with all six faces unpainted (`EMPTY`). */
export function emptyTextureModel(): TextureModel {
  const faces = {} as Record<BoxFace, Uint8Array>
  for (const face of BOX_FACES) {
    const arr = new Uint8Array(FACE_SIZE * FACE_SIZE)
    arr.fill(EMPTY)
    faces[face] = arr
  }
  return { faces }
}

/** Reads a texel's grayscale index (or `EMPTY`). Out-of-bounds reads return `EMPTY`. */
export function getTexel(texture: TextureModel, face: BoxFace, u: number, v: number): number {
  if (!withinFace(u, v)) return EMPTY
  return texture.faces[face][texelIndex(u, v)]
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
