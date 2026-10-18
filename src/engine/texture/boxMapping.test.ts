import { describe, expect, it } from 'vitest'
import type { ChamferCell, GridExtent } from '@/engine/grid/types'
import { atlasDimsFor, atlasUVFor, boxFaceForCell, buildBlendAtlas, worldToTexel } from './boxMapping'
import { emptyTextureModel } from './TextureStore'
import { BOX_FACES, EMPTY, faceSizeFor, halfWorldFor } from './types'

// Matches the pre-per-project-sizing fixed extent, so existing numeric expectations stay exact.
const EXTENT: GridExtent = 16
const FACE_SIZE = faceSizeFor(EXTENT)
const HALF_WORLD = halfWorldFor(EXTENT)

describe('worldToTexel', () => {
  it('maps the working-volume corners of the +Z face to opposite texel corners', () => {
    // z-axis basis: uDir = +X, vDir = -Y → tu = (x+HALF)*4, tv = (-y+HALF)*4
    expect(worldToTexel('pz', -HALF_WORLD, HALF_WORLD, 0, EXTENT)).toEqual([0, 0])
    expect(worldToTexel('pz', HALF_WORLD, -HALF_WORLD, 0, EXTENT)).toEqual([FACE_SIZE, FACE_SIZE])
  })

  it('flips exactly one in-plane axis on the far face of each pair (box-map wrap)', () => {
    const at = [3, -2, 5] as const
    // x pair: same V, U mirrored (nx flips U).
    const [pxU, pxV] = worldToTexel('px', ...at, EXTENT)
    const [nxU, nxV] = worldToTexel('nx', ...at, EXTENT)
    expect(nxV).toBe(pxV)
    expect(nxU).toBe(FACE_SIZE - pxU)

    // z pair: same V, U mirrored (nz flips U).
    const [pzU, pzV] = worldToTexel('pz', ...at, EXTENT)
    const [nzU, nzV] = worldToTexel('nz', ...at, EXTENT)
    expect(nzV).toBe(pzV)
    expect(nzU).toBe(FACE_SIZE - pzU)

    // y pair: same U, V mirrored (py flips V).
    const [pyU, pyV] = worldToTexel('py', ...at, EXTENT)
    const [nyU, nyV] = worldToTexel('ny', ...at, EXTENT)
    expect(pyU).toBe(nyU)
    expect(pyV).toBe(FACE_SIZE - nyV)
  })

  it('scales faceSize/halfWorld proportionally with a different project gridExtent', () => {
    const small: GridExtent = 8
    expect(faceSizeFor(small)).toBe(32)
    expect(halfWorldFor(small)).toBe(4)
    // Same world corner, different extent → different (proportionally scaled) texel corner.
    expect(worldToTexel('pz', -halfWorldFor(small), halfWorldFor(small), 0, small)).toEqual([0, 0])
    expect(worldToTexel('pz', halfWorldFor(small), -halfWorldFor(small), 0, small)).toEqual([faceSizeFor(small), faceSizeFor(small)])
  })
})

describe('boxFaceForCell', () => {
  const chamfer: ChamferCell = { planeAxis: 'x', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } }

  it('uses the authored plane axis/orientation for chamfer cells, ignoring the face normal', () => {
    expect(boxFaceForCell(chamfer, [0, 0, 1])).toBe('px')
    expect(boxFaceForCell(chamfer, [0, -1, 0])).toBe('px')
    expect(boxFaceForCell({ ...chamfer, planeOrientation: -1 }, [0, 0, 1])).toBe('nx')
  })

  it('flips the page for half slabs, whose stored basis is the solid (non-viewer) side', () => {
    // Recessed paint on z/1 stores (z,−1) with the void toward +z: the viewer-facing broad
    // face must sample 'pz', exactly like a thin slab or full voxel facing +z.
    const recessed: ChamferCell = { planeAxis: 'z', planeOrientation: -1, resolvedTo: { shapeKind: 'half', rotation: 0 } }
    expect(boxFaceForCell(recessed, [0, 0, 1])).toBe('pz')
    expect(boxFaceForCell(recessed, [0, 0, -1])).toBe('pz')
    // The void-side page follows the void: an outward (z,1) half samples 'nz'.
    const proud: ChamferCell = { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'half', rotation: 0 } }
    expect(boxFaceForCell(proud, [0, 0, 1])).toBe('nz')
    // Other shapes are untouched by the flip.
    const thin: ChamferCell = { planeAxis: 'z', planeOrientation: -1, resolvedTo: { shapeKind: 'thin', rotation: 0 } }
    expect(boxFaceForCell(thin, [0, 0, 1])).toBe('nz')
  })

  it('maps post/quarter columns cube-like: each face samples its own dominant-normal page', () => {
    // A z-authored column's ends sample the end pages and its sides the side pages — the
    // authoring basis only places the geometry, never the texture.
    const post: ChamferCell = { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'post', rotation: 0 } }
    const quarter: ChamferCell = { planeAxis: 'z', planeOrientation: -1, resolvedTo: { shapeKind: 'quarter', rotation: 2 } }
    for (const cell of [post, quarter]) {
      expect(boxFaceForCell(cell, [1, 0, 0])).toBe('px')
      expect(boxFaceForCell(cell, [-1, 0, 0])).toBe('nx')
      expect(boxFaceForCell(cell, [0, 1, 0])).toBe('py')
      expect(boxFaceForCell(cell, [0, -1, 0])).toBe('ny')
      expect(boxFaceForCell(cell, [0, 0, 1])).toBe('pz')
      expect(boxFaceForCell(cell, [0, 0, -1])).toBe('nz')
    }
  })

  it('maps flats to the authoring page like thin slabs and wedges', () => {
    // A z-authored flat's quad samples 'pz' regardless of the queried normal; a flatwedge
    // samples its authoring page like every other wedge-family face.
    const flat: ChamferCell = { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'flat', rotation: 0 } }
    expect(boxFaceForCell(flat, [0, 0, 1])).toBe('pz')
    expect(boxFaceForCell(flat, [0, 0, -1])).toBe('pz')
    const flatwedge: ChamferCell = { planeAxis: 'x', planeOrientation: -1, resolvedTo: { shapeKind: 'flatwedge', rotation: 2 } }
    expect(boxFaceForCell(flatwedge, [0, 0, 1])).toBe('nx')
    expect(boxFaceForCell(flatwedge, [1, 1, 0])).toBe('nx')
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
      const [u0, v0] = atlasUVFor(f, 0, 0, EXTENT)
      const [u1, v1] = atlasUVFor(f, FACE_SIZE, FACE_SIZE, EXTENT)
      return { f, u0, v0, u1, v1 }
    })
    for (const r of rects) {
      expect(r.u0).toBeGreaterThanOrEqual(0)
      expect(r.v0).toBeGreaterThanOrEqual(0)
      expect(r.u1).toBeLessThanOrEqual(1)
      expect(r.v1).toBeLessThanOrEqual(1)
    }
    // No two faces overlap in atlas center points.
    const centers = BOX_FACES.map((f) => atlasUVFor(f, FACE_SIZE / 2, FACE_SIZE / 2, EXTENT).join(','))
    expect(new Set(centers).size).toBe(BOX_FACES.length)
  })

  it('stores blend values (neutral where unpainted) and places a painted texel at its atlas pixel', () => {
    const tex = emptyTextureModel(EXTENT)
    tex.faces.px[0] = 0 // darkest (index 0 → blend 0) at (0,0) of +X face
    tex.faces.px[1] = 7 // lightest (index 7 → blend 1)
    const { data, width, height } = buildBlendAtlas(tex, EXTENT)
    const { width: atlasWidth, height: atlasHeight } = atlasDimsFor(EXTENT)
    expect(width).toBe(atlasWidth)
    expect(height).toBe(atlasHeight)

    // +X face occupies atlas cell (col 0, row 0) → its (0,0) texel is atlas pixel (0,0).
    expect([data[0], data[1], data[2], data[3]]).toEqual([0, 0, 0, 255])
    // Next texel (index 4 → blend 1 → 255).
    expect([data[4], data[5], data[6]]).toEqual([255, 255, 255])
    // An untouched texel stays neutral (blend 0.5 → 128).
    const p = (1 * atlasWidth + 5) * 4
    expect([data[p], data[p + 1], data[p + 2]]).toEqual([128, 128, 128])
    // Sanity: EMPTY sentinel is what an untouched face array holds.
    expect(tex.faces.py[10]).toBe(EMPTY)
  })

  it('atlas dimensions scale proportionally with a different project gridExtent', () => {
    const small: GridExtent = 8
    const dims = atlasDimsFor(small)
    expect(dims.faceSize).toBe(32)
    expect(dims.width).toBe(3 * 32)
    expect(dims.height).toBe(2 * 32)
  })
})
