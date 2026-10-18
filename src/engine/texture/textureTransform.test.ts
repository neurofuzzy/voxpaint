import { describe, expect, it } from 'vitest'
import type { GridExtent } from '@/engine/grid/types'
import { emptyTextureModel } from './TextureStore'
import { EMPTY } from './types'
import { textureContentEquals, transformTextureWholeModel, translateTextureModelWrap } from './textureTransform'

// Tiny faces (8x8) so single-texel expectations stay readable.
const EXTENT: GridExtent = 8
const N = 8

function countPainted(face: Uint8Array): number {
  let n = 0
  for (const t of face) if (t !== EMPTY) n++
  return n
}

describe('translateTextureModelWrap', () => {
  it('shifts pz +u for a +x world delta', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.pz[3 * N + 2] = 5
    const next = translateTextureModelWrap(tex, [1, 0, 0], EXTENT, 1)
    expect(next.faces.pz[3 * N + 3]).toBe(5)
    expect(next.faces.pz[3 * N + 2]).toBe(EMPTY)
  })

  it('shifts pz +v for a +1 dv drag on the z plane (world -y, canvas-down v)', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.pz[3 * N + 2] = 5
    const next = translateTextureModelWrap(tex, [0, -1, 0], EXTENT, 1)
    expect(next.faces.pz[4 * N + 2]).toBe(5)
  })

  it('wraps around so nothing is lost', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.pz[7] = 5
    tex.faces.pz[7 * N] = 6
    const before = countPainted(tex.faces.pz)
    const next = translateTextureModelWrap(tex, [1, 0, 0], EXTENT, 1)
    expect(next.faces.pz[0]).toBe(5)
    expect(countPainted(next.faces.pz)).toBe(before)
    // Full-face wrap is the identity.
    expect(textureContentEquals(translateTextureModelWrap(tex, [8, 0, 0], EXTENT, 1), tex)).toBe(true)
  })

  it('leaves depth-axis faces byte-identical', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.px.fill(2)
    tex.faces.pz[3 * N + 2] = 5
    const next = translateTextureModelWrap(tex, [1, 0, 0], EXTENT, 1)
    expect(next.faces.px).toEqual(tex.faces.px)
    expect(next.faces.nx).toEqual(tex.faces.nx)
    expect(next.faces.pz[3 * N + 2]).toBe(EMPTY)
  })
})

describe('transformTextureWholeModel', () => {
  it('cycles z-plane side slots cw (px <- py <- nx <- ny <- px), caps stay', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.px.fill(0)
    tex.faces.nx.fill(1)
    tex.faces.py.fill(2)
    tex.faces.ny.fill(3)
    tex.faces.pz.fill(4)
    tex.faces.nz.fill(5)
    const next = transformTextureWholeModel(tex, 'rotate', 'z', EXTENT, 1)
    expect(new Set(next.faces.px).size).toBe(1)
    expect(next.faces.px[0]).toBe(2)
    expect(next.faces.py[0]).toBe(1)
    expect(next.faces.nx[0]).toBe(3)
    expect(next.faces.ny[0]).toBe(0)
    expect(next.faces.pz[0]).toBe(4)
    expect(next.faces.nz[0]).toBe(5)
  })

  it('tracks a side-texel cw about z (py -> px with in-plane turn)', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.py[3 * N + 2] = 6
    const next = transformTextureWholeModel(tex, 'rotate', 'z', EXTENT, 1)
    // dst(px,tu,tv) <- src(py, tv, N-1-tu): src (2,3) lands at tu = N-1-3, tv = 2.
    expect(next.faces.px[2 * N + (N - 1 - 3)]).toBe(6)
    expect(countPainted(next.faces.px)).toBe(1)
  })

  it('spins cap faces in-plane on rotate (pz stays pz, rotated)', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.pz[2 * N + 1] = 6
    const next = transformTextureWholeModel(tex, 'rotate', 'z', EXTENT, 1)
    // dst(pz,tu,tv) <- src(pz, tv, N-1-tu): src (1,2) lands at (N-1-2, 1).
    expect(next.faces.pz[1 * N + (N - 1 - 2)]).toBe(6)
    expect(countPainted(next.faces.pz)).toBe(1)
    for (const f of ['px', 'nx', 'py', 'ny', 'nz'] as const) {
      expect(countPainted(next.faces[f])).toBe(0)
    }
  })

  it('mirrors px <-> nx on z-plane mirror-h with an in-plane flip', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.nx[2 * N + 1] = 6
    const next = transformTextureWholeModel(tex, 'mirror-h', 'z', EXTENT, 1)
    expect(next.faces.px[2 * N + (N - 1 - 1)]).toBe(6)
    expect(countPainted(next.faces.px)).toBe(1)
  })

  it('round-trips (cw/ccw, mirrors, every plane axis)', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    // Asymmetric paint on every face so any slot or in-plane error breaks the round-trip.
    const seed = [11, 22, 33, 44, 55, 66]
    const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const
    faces.forEach((f, fi) => {
      for (let i = 0; i < N * N; i++) tex.faces[f][i] = (seed[fi] + i) % 8
    })
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(textureContentEquals(transformTextureWholeModel(transformTextureWholeModel(tex, 'rotate', axis, EXTENT, 1), 'rotate-ccw', axis, EXTENT, 1), tex)).toBe(true)
      let spun = tex
      for (let i = 0; i < 4; i++) spun = transformTextureWholeModel(spun, 'rotate', axis, EXTENT, 1)
      expect(textureContentEquals(spun, tex)).toBe(true)
      for (const mirror of ['mirror-h', 'mirror-v'] as const) {
        const twice = transformTextureWholeModel(transformTextureWholeModel(tex, mirror, axis, EXTENT, 1), mirror, axis, EXTENT, 1)
        expect(textureContentEquals(twice, tex)).toBe(true)
      }
    }
  })

  it('preserves the painted texel count', () => {
    const tex = emptyTextureModel(EXTENT, 1)
    tex.faces.px[0] = 0
    tex.faces.nz[5 * N + 5] = 7
    const total = (t: typeof tex) => (['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const).reduce((n, f) => n + countPainted(t.faces[f]), 0)
    expect(total(transformTextureWholeModel(tex, 'rotate', 'y', EXTENT, 1))).toBe(total(tex))
  })
})

describe('textureContentEquals', () => {
  it('compares faces byte-wise', () => {
    const a = emptyTextureModel(EXTENT, 1)
    const b = emptyTextureModel(EXTENT, 1)
    expect(textureContentEquals(a, b)).toBe(true)
    b.faces.pz[0] = 0
    expect(textureContentEquals(a, b)).toBe(false)
  })
})
