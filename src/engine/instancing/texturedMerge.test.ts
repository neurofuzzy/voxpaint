import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import type { ChamferCell, VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { atlasUVFor, boxFaceForCell, worldToTexel } from '@/engine/texture/boxMapping'
import { buildTexturedGeometryByColorMerged } from '@/engine/texture/texturedGeometry'
import { mergeCoplanarFacesWithKeys, triangleCount } from './meshOptimizer'
import { buildTexturedShellGeometryByColor } from './voxelMeshBuilder'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
const GRID_EXTENT = 16

/** Two adjacent same-color cubes: shell is 10 quads (20 tris), merged domino is 6 quads (12 tris). */
function domino(): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
  model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
  return model
}

function triArea(geom: THREE.BufferGeometry, t: number): number {
  const pos = geom.getAttribute('position')
  const a = new THREE.Vector3().fromBufferAttribute(pos, t * 3)
  const b = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 1)
  const c = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 2)
  return new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).length() / 2
}

function surfaceArea(groups: { geometry: THREE.BufferGeometry }[]): number {
  let area = 0
  for (const g of groups) {
    const n = triangleCount(g.geometry)
    for (let t = 0; t < n; t++) area += triArea(g.geometry, t)
  }
  return area
}

/** Two adjacent coplanar unit quads (4 tris) with flat +Z normals, for the tag-barrier unit test. */
function twoQuads(): THREE.BufferGeometry {
  const positions = [
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
    1, 0, 0, 2, 0, 0, 2, 1, 0,
    1, 0, 0, 2, 1, 0, 1, 1, 0,
  ]
  const normals = new Array(12).fill([0, 0, 1]).flat()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geometry
}

describe('tag-aware coplanar merge', () => {
  it('refuses to weld coplanar quads carrying different tags (keys preserved per triangle)', () => {
    const { geometry, keys } = mergeCoplanarFacesWithKeys(twoQuads(), (t) => (t < 2 ? 'a' : 'b'))
    expect(triangleCount(geometry)).toBe(4)
    expect(keys).toEqual(['a', 'a', 'b', 'b'])
  })

  it('welds coplanar quads carrying the same tag', () => {
    const { geometry, keys } = mergeCoplanarFacesWithKeys(twoQuads(), () => 'a')
    expect(triangleCount(geometry)).toBe(2)
    expect(keys).toEqual(['a', 'a'])
  })
})

describe('merged textured shell', () => {
  it('reduces the domino shell 20 → 12 tris with the toggle on, and matches the shell with it off', () => {
    const merged = buildTexturedGeometryByColorMerged(domino(), DEFAULT_PALETTE, GRID_EXTENT, true)
    expect(merged.groups).toHaveLength(1)
    expect(merged.rawTriangles).toBe(20)
    expect(merged.optimizedTriangles).toBe(12)

    const plain = buildTexturedGeometryByColorMerged(domino(), DEFAULT_PALETTE, GRID_EXTENT, false)
    expect(plain.rawTriangles).toBe(20)
    expect(plain.optimizedTriangles).toBe(20)
  })

  it('toggle-off output is identical to the legacy shell path (positions, normals, colors, UVs)', () => {
    const uvFor = (
      chamfer: ChamferCell | undefined,
      normal: THREE.Vector3,
      vertex: THREE.Vector3,
    ): [number, number] => {
      const face = boxFaceForCell(chamfer, [normal.x, normal.y, normal.z])
      const [tu, tv] = worldToTexel(face, vertex.x, vertex.y, vertex.z, GRID_EXTENT)
      return atlasUVFor(face, tu, tv, GRID_EXTENT)
    }
    const legacy = buildTexturedShellGeometryByColor(domino(), DEFAULT_PALETTE, uvFor)
    const plain = buildTexturedGeometryByColorMerged(domino(), DEFAULT_PALETTE, GRID_EXTENT, false)
    expect(plain.groups).toHaveLength(legacy.length)
    for (let i = 0; i < legacy.length; i++) {
      for (const attr of ['position', 'normal', 'color', 'uv'] as const) {
        expect(
          Array.from(plain.groups[i].geometry.getAttribute(attr).array),
          `group ${i} ${attr}`,
        ).toEqual(Array.from(legacy[i].geometry.getAttribute(attr).array))
      }
    }
  })

  it('preserves total surface area across the merge (no dropped or invented surface)', () => {
    const merged = buildTexturedGeometryByColorMerged(domino(), DEFAULT_PALETTE, GRID_EXTENT, true)
    const plain = buildTexturedGeometryByColorMerged(domino(), DEFAULT_PALETTE, GRID_EXTENT, false)
    expect(surfaceArea(merged.groups)).toBeCloseTo(surfaceArea(plain.groups), 6)
  })

  it('interpolated UVs on a merged triangle match the box-map projection exactly (affine exactness)', () => {
    const merged = buildTexturedGeometryByColorMerged(domino(), DEFAULT_PALETTE, GRID_EXTENT, true)
    const geom = merged.groups[0].geometry
    const pos = geom.getAttribute('position')
    const uv = geom.getAttribute('uv')
    // A merged top-face triangle: plain-cube +Y faces sample the py page.
    let tri = -1
    const n = new THREE.Vector3()
    const nrm = geom.getAttribute('normal')
    for (let t = 0; t < pos.count / 3; t++) {
      n.fromBufferAttribute(nrm, t * 3)
      if (Math.abs(n.x) < 1e-6 && Math.abs(n.z) < 1e-6 && n.y > 0) {
        tri = t
        break
      }
    }
    expect(tri).toBeGreaterThanOrEqual(0)
    const p = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, tri * 3 + k))
    const uvs = [0, 1, 2].map((k) => [uv.getX(tri * 3 + k), uv.getY(tri * 3 + k)] as const)
    // Barycentric-interpolate the stored UVs at the centroid (centroid = equal weights).
    const interp: [number, number] = [
      (uvs[0][0] + uvs[1][0] + uvs[2][0]) / 3,
      (uvs[0][1] + uvs[1][1] + uvs[2][1]) / 3,
    ]
    const c = new THREE.Vector3().add(p[0]).add(p[1]).add(p[2]).divideScalar(3)
    const [tu, tv] = worldToTexel('py', c.x, c.y, c.z, GRID_EXTENT)
    const expected = atlasUVFor('py', tu, tv, GRID_EXTENT)
    expect(interp[0]).toBeCloseTo(expected[0], 6)
    expect(interp[1]).toBeCloseTo(expected[1], 6)
  })

  it('leaves a lone chamfer cell unmerged in count (no cross-orientation welds)', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.chamfer.set(encodeKey(0, 0, 0), {
      planeAxis: 'y',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'ramp', rotation: 0 },
    })
    const merged = buildTexturedGeometryByColorMerged(model, DEFAULT_PALETTE, GRID_EXTENT, true)
    const plain = buildTexturedGeometryByColorMerged(model, DEFAULT_PALETTE, GRID_EXTENT, false)
    expect(merged.groups).toHaveLength(1)
    expect(merged.optimizedTriangles).toBe(plain.optimizedTriangles)
    expect(merged.rawTriangles).toBe(plain.rawTriangles)
  })
})
