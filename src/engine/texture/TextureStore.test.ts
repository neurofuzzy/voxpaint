import { describe, expect, it } from 'vitest'
import { faceSizeFor } from './types'
import { emptyTextureModel, normalizeTexelScale, resampleTextureModel } from './TextureStore'
import { EMPTY } from './types'

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
