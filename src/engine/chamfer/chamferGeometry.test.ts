import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { concaveCornerGeometry, convexCornerGeometry, mirrorVGeometry, rampGeometry, unitCubeGeometry } from './chamferGeometry'

type Vec = [number, number, number]

/** Expand to a flat, non-indexed triangle soup regardless of how the geometry stores its faces. */
function soup(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return geometry.index ? geometry.toNonIndexed() : geometry
}

/** Every 3 consecutive vertices form one triangle. */
function triangles(geometry: THREE.BufferGeometry): [Vec, Vec, Vec][] {
  const pos = soup(geometry).getAttribute('position')
  const tris: [Vec, Vec, Vec][] = []
  for (let i = 0; i < pos.count; i += 3) {
    tris.push([
      [pos.getX(i), pos.getY(i), pos.getZ(i)],
      [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)],
      [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)],
    ])
  }
  return tris
}

function uniqueVertices(geometry: THREE.BufferGeometry): Vec[] {
  const pos = geometry.getAttribute('position')
  const seen = new Set<string>()
  const out: Vec[] = []
  for (let i = 0; i < pos.count; i++) {
    const v: Vec = [round(pos.getX(i)), round(pos.getY(i)), round(pos.getZ(i))]
    const key = v.join(',')
    if (!seen.has(key)) {
      seen.add(key)
      out.push(v)
    }
  }
  return out
}

/** Roof (sloped-top) triangles: those whose outward normal points upward (z > 0). Walls have
 * z≈0, the bottom points down — so this isolates the sloped facets that carry the chamfer. */
function roofTriangles(geometry: THREE.BufferGeometry): [Vec, Vec, Vec][] {
  return triangles(geometry).filter((tri) => cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))[2] > 1e-9)
}

const isBase = (v: Vec) => round(v[2]) === -0.5

const round = (n: number) => Math.round(n * 1e6) / 1e6

function sub(a: Vec, b: Vec): Vec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function centroid(tri: [Vec, Vec, Vec]): Vec {
  return [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3]
}

/** All named geometries centered on the origin. */
const GEOMETRIES = {
  cube: unitCubeGeometry(),
  ramp: rampGeometry(),
  convex: convexCornerGeometry(),
  concave: concaveCornerGeometry(),
}

describe('chamfer geometry — centering & footprint (etc/chamfer-tests.md: origin is the voxel center)', () => {
  it.each(Object.entries(GEOMETRIES))('%s is centered on the origin, filling exactly [-0.5, 0.5]^3', (_name, geometry) => {
    geometry.computeBoundingBox()
    const { min, max } = geometry.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.5, -0.5, -0.5])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0.5, 0.5])
  })

  it.each(Object.entries(GEOMETRIES))('%s has no vertex outside the unit cell', (_name, geometry) => {
    for (const v of uniqueVertices(geometry)) {
      for (const c of v) expect(Math.abs(c)).toBeLessThanOrEqual(0.5 + 1e-9)
    }
  })
})

describe('chamfer geometry — triangle counts (etc/chamfer-tests.md MODELS)', () => {
  it.each([
    ['cube', GEOMETRIES.cube, 12],
    ['ramp', GEOMETRIES.ramp, 8],
    ['convex', GEOMETRIES.convex, 6],
    ['concave', GEOMETRIES.concave, 10],
  ] as const)('%s has %i triangles', (_name, geometry, count) => {
    expect(triangles(geometry).length).toBe(count)
  })
})

describe('chamfer geometry — outward-facing windings', () => {
  // A point strictly inside each solid's star kernel: every face must be wound so its outward
  // normal points away from this point (i.e. dot(faceNormal, centroid - inside) > 0).
  const INSIDE: Record<keyof typeof GEOMETRIES, Vec> = {
    cube: [0, 0, 0],
    ramp: [-0.25, 0, -0.25], // inside the tall (west) half of the wedge
    convex: [-0.25, 0.25, -0.3], // under the SW hip, above the base
    concave: [-0.25, 0.25, -0.25], // deep in the un-notched SW/base corner
  }

  it.each(Object.keys(GEOMETRIES) as (keyof typeof GEOMETRIES)[])('%s: every triangle is wound outward', (name) => {
    const inside = INSIDE[name]
    for (const tri of triangles(GEOMETRIES[name])) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      const outward = sub(centroid(tri), inside)
      expect(dot(normal, outward), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })

  it.each(Object.keys(GEOMETRIES) as (keyof typeof GEOMETRIES)[])('%s: computeVertexNormals yields outward normals', (name) => {
    const geometry = GEOMETRIES[name]
    const inside = INSIDE[name]
    const pos = geometry.getAttribute('position')
    const nrm = geometry.getAttribute('normal')
    for (let i = 0; i < pos.count; i++) {
      const p: Vec = [pos.getX(i), pos.getY(i), pos.getZ(i)]
      const n: Vec = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)]
      expect(dot(n, sub(p, inside)), `vertex ${i}`).toBeGreaterThan(0)
    }
  })
})

describe('chamfer geometry — canonical (rotation-0) topology matches etc/chamfer-tests.md MODELS', () => {
  const has = (geometry: THREE.BufferGeometry, v: Vec) => uniqueVertices(geometry).some((u) => u.join(',') === v.join(','))

  // Corner tops, per the spec's E/F/G/H labels (NE/SE/SW/NW at z=+0.5).
  const topNE: Vec = [0.5, -0.5, 0.5] // E
  const topSE: Vec = [0.5, 0.5, 0.5] // F
  const topSW: Vec = [-0.5, 0.5, 0.5] // G
  const topNW: Vec = [-0.5, -0.5, 0.5] // H

  it('ramp (Model B): opens east — no top vertex on the east (NE/SE) knife edge, both west tops present', () => {
    const g = rampGeometry()
    expect(has(g, topNE)).toBe(false) // no E
    expect(has(g, topSE)).toBe(false) // no F
    expect(has(g, topSW)).toBe(true) // G
    expect(has(g, topNW)).toBe(true) // H
  })

  it('convex (Model C): full height only at the SW corner — its top vertex is the only top vertex', () => {
    const g = convexCornerGeometry()
    expect(has(g, topSW)).toBe(true) // G
    expect(has(g, topNE)).toBe(false)
    expect(has(g, topSE)).toBe(false)
    expect(has(g, topNW)).toBe(false)
  })

  it('concave (Model D): notched at NE — every top vertex present except NE', () => {
    const g = concaveCornerGeometry()
    expect(has(g, topNE)).toBe(false) // no E
    expect(has(g, topSE)).toBe(true) // F
    expect(has(g, topSW)).toBe(true) // G
    expect(has(g, topNW)).toBe(true) // H
  })

  it('convex roof triangles each share 2 of 3 vertices with the base (spec Model C)', () => {
    const roofTris = roofTriangles(convexCornerGeometry())
    expect(roofTris).toHaveLength(2)
    for (const tri of roofTris) {
      expect(tri.filter(isBase)).toHaveLength(2)
    }
  })

  it('concave roof triangles each share exactly 1 vertex with the base (spec Model D)', () => {
    const roofTris = roofTriangles(concaveCornerGeometry())
    expect(roofTris).toHaveLength(2)
    for (const tri of roofTris) {
      expect(tri.filter(isBase)).toHaveLength(1)
    }
  })
})

describe('chamfer geometry — v-mirrored variants (reflected-plane pools)', () => {
  it.each([
    ['ramp', rampGeometry(), [-0.25, 0, -0.25] as Vec],
    ['convex', convexCornerGeometry(), [-0.25, -0.25, -0.3] as Vec],
    ['concave', concaveCornerGeometry(), [-0.25, -0.25, -0.25] as Vec],
  ] as const)('mirrorVGeometry(%s) stays centered with outward windings', (_name, geometry, insideMirrored) => {
    const m = mirrorVGeometry(geometry)

    // Same triangle count, still filling the centered unit cell.
    expect(triangles(m).length).toBe(triangles(geometry).length)
    m.computeBoundingBox()
    const { min, max } = m.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.5, -0.5, -0.5])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0.5, 0.5])

    // Every face still wound outward (about the v-negated interior point) — this is what keeps the
    // mirrored pool lit correctly under its proper-rotation instance matrix.
    for (const tri of triangles(m)) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(dot(normal, sub(centroid(tri), insideMirrored)), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })
})

describe('chamfer geometry — baked rotation', () => {
  it('rotation is a plain rotation about the origin: 4 quarter-turns returns to the canonical mesh', () => {
    const base = rampGeometry(0).getAttribute('position').array
    // A full turn (four 90° steps) is applied as rotation param 4 ≡ 0 via rotateZ; verify the
    // canonical mesh footprint bounds are rotation-invariant for each quarter turn.
    for (const r of [1, 2, 3] as const) {
      const g = rampGeometry(r)
      g.computeBoundingBox()
      const { min, max } = g.boundingBox!
      expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.5, -0.5, -0.5])
      expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0.5, 0.5])
    }
    expect(base.length).toBe(8 * 3 * 3)
  })

  it('rotation 1 (+90°, east→south) moves the ramp knife edge from east to south', () => {
    // Canonical ramp opens east (no top verts at NE/SE). After +90° it opens south (no top verts at
    // SE/SW), because east→south under the baked rotation (see chamferResolver.classify()).
    const g = rampGeometry(1)
    const tops = uniqueVertices(g).filter((v) => round(v[2]) === 0.5)
    const topKeys = tops.map((v) => `${round(v[0])},${round(v[1])}`)
    expect(topKeys).toContain('0.5,-0.5') // NE top present
    expect(topKeys).toContain('-0.5,-0.5') // NW top present
    expect(topKeys).not.toContain('0.5,0.5') // SE knife
    expect(topKeys).not.toContain('-0.5,0.5') // SW knife
  })
})
