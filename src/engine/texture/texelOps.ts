import type { SelectionRegion } from '@/store/types'
import { EMPTY, FACE_SIZE } from './types'
import { texelIndex, withinFace } from './TextureStore'

/**
 * A rectangular block of texels lifted from a face (copy/cut/float buffer). `cells` is a dense
 * `width×height` grayscale grid; `EMPTY` marks holes (texels outside the source selection mask, or
 * unpainted source texels), which are skipped on paste. Parallels the voxel `ClipboardData`, but on
 * a flat grayscale grid instead of sparse color/chamfer cells.
 */
export type TexelClip = {
  width: number
  height: number
  cells: Uint8Array
  /** Top-left of the region this was copied from (paste-in-place). Omitted on transformed floats. */
  originU?: number
  originV?: number
}

/** 4-connected flood fill over a face, matching the grayscale index at the seed. Returns the texel
 * coordinates to recolor; the caller applies them (so it can run inside one undo stroke). */
export function floodFillFace(arr: Uint8Array, startU: number, startV: number): Array<[number, number]> {
  if (!withinFace(startU, startV)) return []
  const target = arr[texelIndex(startU, startV)]
  const visited = new Uint8Array(FACE_SIZE * FACE_SIZE)
  const stack: Array<[number, number]> = [[startU, startV]]
  const result: Array<[number, number]> = []
  while (stack.length > 0) {
    const [u, v] = stack.pop()!
    if (!withinFace(u, v)) continue
    const i = texelIndex(u, v)
    if (visited[i]) continue
    visited[i] = 1
    if (arr[i] !== target) continue
    result.push([u, v])
    stack.push([u + 1, v], [u - 1, v], [u, v + 1], [u, v - 1])
  }
  return result
}

/** Copy the selected texels of `arr` into a dense clip (unselected/out-of-bounds texels → `EMPTY`). */
export function copyRegion(arr: Uint8Array, selection: SelectionRegion): TexelClip {
  const { originU, originV, width, height, mask } = selection
  const cells = new Uint8Array(width * height).fill(EMPTY)
  for (let dv = 0; dv < height; dv++) {
    for (let du = 0; du < width; du++) {
      if (mask[dv * width + du] !== 1) continue
      const u = originU + du
      const v = originV + dv
      if (withinFace(u, v)) cells[dv * width + du] = arr[texelIndex(u, v)]
    }
  }
  return { width, height, cells, originU, originV }
}

/** Erase (set `EMPTY`) the selected texels of `arr` in place. */
export function clearRegion(arr: Uint8Array, selection: SelectionRegion): void {
  const { originU, originV, width, height, mask } = selection
  for (let dv = 0; dv < height; dv++) {
    for (let du = 0; du < width; du++) {
      if (mask[dv * width + du] !== 1) continue
      const u = originU + du
      const v = originV + dv
      if (withinFace(u, v)) arr[texelIndex(u, v)] = EMPTY
    }
  }
}

/** Stamp a clip's non-hole texels into `arr` at (originU, originV), clipped to the face bounds. */
export function applyClipAt(arr: Uint8Array, clip: TexelClip, originU: number, originV: number): void {
  for (let dv = 0; dv < clip.height; dv++) {
    for (let du = 0; du < clip.width; du++) {
      const value = clip.cells[dv * clip.width + du]
      if (value === EMPTY) continue
      const u = originU + du
      const v = originV + dv
      if (withinFace(u, v)) arr[texelIndex(u, v)] = value
    }
  }
}

/** Rotate a clip 90° clockwise (extents swap) — mirrors `rotateRegion90`'s index mapping. */
export function rotateClip90(clip: TexelClip): TexelClip {
  const { width, height, cells } = clip
  const out = new Uint8Array(width * height).fill(EMPTY)
  for (let dv = 0; dv < height; dv++) {
    for (let du = 0; du < width; du++) {
      const ndu = height - 1 - dv
      const ndv = du
      out[ndv * height + ndu] = cells[dv * width + du]
    }
  }
  return { width: height, height: width, cells: out }
}

/** Mirror a clip horizontally or vertically — mirrors `mirrorRegion`'s index mapping. */
export function mirrorClip(clip: TexelClip, axis: 'horizontal' | 'vertical'): TexelClip {
  const { width, height, cells } = clip
  const out = new Uint8Array(width * height).fill(EMPTY)
  for (let dv = 0; dv < height; dv++) {
    for (let du = 0; du < width; du++) {
      const ndu = axis === 'horizontal' ? width - 1 - du : du
      const ndv = axis === 'vertical' ? height - 1 - dv : dv
      out[ndv * width + ndu] = cells[dv * width + du]
    }
  }
  return { width, height, cells: out }
}
