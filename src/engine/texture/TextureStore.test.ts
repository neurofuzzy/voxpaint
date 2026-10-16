import { describe, expect, it } from 'vitest'
import { faceSizeFor } from './types'
import { EMPTY } from './types'
import { emptyTextureModel, getTexel, normalizeTexelScale, resampleTextureModel, rescaleTextureModel2x } from './TextureStore'

describe('faceSizeFor with texel scale', () => {
  it('scales the face edge by texels-per-voxel (default 4)', () => {
    expect(faceSizeFor(16)).toBe(64)
    expect(faceSizeFor(16, 4)).toBe(64)
    expect(faceSizeFor(16, 2)).toBe(32)
    expect(faceSizeFor(16, 1)).toBe(16)
  })
})

describe('normalizeTexelScale', () => {
  it('passes 1/2/4 through and falls back to 4 otherwise', () => {
    expect(normalizeTexelScale(1)).toBe(1)
    expect(normalizeTexelScale(2)).toBe(2)
    expect(normalizeTexelScale(4)).toBe(4)
    for (const bad of [0, 3, 5, 7, 99, NaN]) expect(normalizeTexelScale(bad)).toBe(4)
  })
})

describe('resampleTextureModel', () => {
  it('upscales 1→4 into constant 4x4 blocks (nearest, not blurred)', () => {
    const src = emptyTextureModel(16, 1)
    src.faces.px[7 * 16 + 5] = 3 // (5,7)
    const dst = resampleTextureModel(src, 16, 1, 4)
    expect(dst.faces.px.length).toBe(64 * 64)
    for (let tv = 28; tv < 32; tv++) {
      for (let tu = 20; tu < 24; tu++) {
        expect(dst.faces.px[tv * 64 + tu]).toBe(3)
      }
    }
    // Untouched regions stay EMPTY (including the block origin, sampled from EMPTY src).
    expect(dst.faces.px[0]).toBe(EMPTY)
    expect(dst.faces.px[63 * 64 + 63]).toBe(EMPTY)
  })

  it('downscales 4→1 by center-sampling each block', () => {
    const src = emptyTextureModel(16, 4)
    // Dst (1,2) center-samples src floor(1.5*4)=6, floor(2.5*4)=10.
    src.faces.px[10 * 64 + 6] = 7
    // Dst (0,0) center-samples src (2,2).
    src.faces.px[2 * 64 + 2] = 5
    const dst = resampleTextureModel(src, 16, 4, 1)
    expect(dst.faces.px.length).toBe(16 * 16)
    expect(dst.faces.px[2 * 16 + 1]).toBe(7)
    expect(dst.faces.px[0]).toBe(5)
  })

  it('round-trips values upscale-then-downscale (positions re-quantize, values survive)', () => {
    const src = emptyTextureModel(16, 1)
    src.faces.px[0] = 2
    const up = resampleTextureModel(src, 16, 1, 4)
    const back = resampleTextureModel(up, 16, 4, 1)
    // Up sampled src(0,0) into dst block 0..3; down center-samples src(2,2) of that block.
    expect(back.faces.px[0]).toBe(2)
  })

  it('returns an equal-content clone when the scale is unchanged', () => {
    const src = emptyTextureModel(16, 2)
    src.faces.nx[0] = 6
    const dst = resampleTextureModel(src, 16, 2, 2)
    expect(dst.faces.nx[0]).toBe(6)
    expect(dst.faces.nx).not.toBe(src.faces.nx)
  })
})

describe('rescaleTextureModel2x', () => {
  it('duplicates every texel into an exact 2x2 block on even grids', () => {
    const texture = emptyTextureModel(8)
    texture.faces.px[0] = 4
    const last = faceSizeFor(8) - 1
    texture.faces.px[last * faceSizeFor(8) + last] = 1

    const next = rescaleTextureModel2x(texture, 8, 16)
    expect(faceSizeFor(16)).toBe(2 * faceSizeFor(8))
    // First texel -> top-left 2x2 block.
    for (const [tu, tv] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      expect(getTexel(next, 'px', tu, tv, faceSizeFor(16))).toBe(4)
    }
    // Last texel -> bottom-right 2x2 block.
    const n = faceSizeFor(16)
    for (const [tu, tv] of [[n - 2, n - 2], [n - 1, n - 2], [n - 2, n - 1], [n - 1, n - 1]] as const) {
      expect(getTexel(next, 'px', tu, tv, faceSizeFor(16))).toBe(1)
    }
    // Untouched texels stay EMPTY on every face.
    for (const face of ['nx', 'py', 'ny', 'pz', 'nz'] as const) {
      expect(getTexel(next, face, 10, 10, faceSizeFor(16))).toBe(255)
    }
  })

  it('keeps an EMPTY texture EMPTY and preserves paint on odd grids', () => {
    const empty = rescaleTextureModel2x(emptyTextureModel(8), 8, 16)
    for (const face of ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const) {
      expect(empty.faces[face].every((t) => t === 255)).toBe(true)
    }

    // Odd extent rescales to twice the *working* grid (7 -> 16, not 14), so edge content
    // survives the doubling about the origin.
    const odd = emptyTextureModel(7)
    odd.faces.pz[0] = 3
    const grown = rescaleTextureModel2x(odd, 7, 16)
    let painted = 0
    for (const t of grown.faces.pz) if (t !== 255) painted++
    expect(painted).toBeGreaterThan(0)
  })
})
