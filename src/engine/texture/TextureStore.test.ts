import { describe, expect, it } from 'vitest'
import { faceSizeFor } from './types'
import { emptyTextureModel, getTexel, rescaleTextureModel2x } from './TextureStore'

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
