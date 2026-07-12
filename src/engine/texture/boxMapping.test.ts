import { describe, expect, it } from 'vitest'
import type { ChamferCell } from '@/engine/grid/types'
import { atlasUVFor, ATLAS_HEIGHT, ATLAS_WIDTH, boxFaceForCell, buildAtlas, worldToTexel } from './boxMapping'
import { emptyTextureModel } from './TextureStore'
import { BOX_FACES, EMPTY, FACE_SIZE, HALF_WORLD } from './types'

describe('worldToTexel', () => {
  it('maps the working-volume corners of the +Z face to opposite texel corners', () => {
    // z-axis basis: uDir = +X, vDir = -Y → tu = (x+HALF)*4, tv = (-y+HALF)*4
    expect(worldToTexel('pz', -HALF_WORLD, HALF_WORLD, 0)).toEqual([0, 0])
    expect(worldToTexel('pz', HALF_WORLD, -HALF_WORLD, 0)).toEqual([FACE_SIZE, FACE_SIZE])
  })

  it('flips exactly one in-plane axis on the far face of each pair (box-map wrap)', () => {
    const at = [3, -2, 5] as const
    // x pair: same V, U mirrored (nx flips U).
    const [pxU, pxV] = worldToTexel('px', ...at)
    const [nxU, nxV] = worldToTexel('nx', ...at)
    expect(nxV).toBe(pxV)
    expect(nxU).toBe(FACE_SIZE - pxU)

    // z pair: same V, U mirrored (nz flips U).
    const [pzU, pzV] = worldToTexel('pz', ...at)
    const [nzU, nzV] = worldToTexel('nz', ...at)
    expect(nzV).toBe(pzV)
    expect(nzU).toBe(FACE_SIZE - pzU)

    // y pair: same U, V mirrored (py flips V).
    const [pyU, pyV] = worldToTexel('py', ...at)
    const [nyU, nyV] = worldToTexel('ny', ...at)
    expect(pyU).toBe(nyU)
    expect(pyV).toBe(FACE_SIZE - nyV)
  })
})

describe('boxFaceForCell', () => {
  const chamfer: ChamferCell = { planeAxis: 'x', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } }

  it('uses the authored plane axis/orientation for chamfer cells, ignoring the face normal', () => {
    expect(boxFaceForCell(chamfer, [0, 0, 1])).toBe('px')
    expect(boxFaceForCell(chamfer, [0, -1, 0])).toBe('px')
    expect(boxFaceForCell({ ...chamfer, planeOrientation: -1 }, [0, 0, 1])).toBe('nx')
  })

  it('uses the dominant signed normal axis for plain cube faces', () => {
    expect(boxFaceForCell(undefined, [1, 0, 0])).toBe('px')
    expect(boxFaceForCell(undefined, [-1, 0, 0])).toBe('nx')
    expect(boxFaceForCell(undefined, [0, 1, 0])).toBe('py')
    expect(boxFaceForCell(undefined, [0, 0, -1])).toBe('nz')
  })
})

describe('atlas', () => {
  it('gives every face a disjoint UV rect inside [0,1]', () => {
    const rects = BOX_FACES.map((f) => {
      const [u0, v0] = atlasUVFor(f, 0, 0)
      const [u1, v1] = atlasUVFor(f, FACE_SIZE, FACE_SIZE)
      return { f, u0, v0, u1, v1 }
    })
    for (const r of rects) {
      expect(r.u0).toBeGreaterThanOrEqual(0)
      expect(r.v0).toBeGreaterThanOrEqual(0)
      expect(r.u1).toBeLessThanOrEqual(1)
      expect(r.v1).toBeLessThanOrEqual(1)
    }
    // No two faces overlap in atlas center points.
    const centers = BOX_FACES.map((f) => atlasUVFor(f, FACE_SIZE / 2, FACE_SIZE / 2).join(','))
    expect(new Set(centers).size).toBe(BOX_FACES.length)
  })

  it('defaults unpainted texels to opaque white and places a painted texel at its atlas pixel', () => {
    const tex = emptyTextureModel()
    tex.faces.px[0] = 0 // black at (0,0) of +X face
    const { data, width, height } = buildAtlas(tex)
    expect(width).toBe(ATLAS_WIDTH)
    expect(height).toBe(ATLAS_HEIGHT)

    // +X face occupies atlas cell (col 0, row 0) → its (0,0) texel is atlas pixel (0,0).
    expect([data[0], data[1], data[2], data[3]]).toEqual([0, 0, 0, 255])
    // An untouched texel elsewhere on the same face stays white.
    const p = (1 * ATLAS_WIDTH + 1) * 4
    expect([data[p], data[p + 1], data[p + 2], data[p + 3]]).toEqual([255, 255, 255, 255])
    // Sanity: EMPTY sentinel is what an untouched face array holds.
    expect(tex.faces.py[10]).toBe(EMPTY)
  })
})
