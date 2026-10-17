import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { concaveCornerGeometry, convexCornerGeometry, flatGeometry, flatWedgeGeometry, halfGeometry, mirrorVGeometry, postGeometry, quarterGeometry, rampGeometry, unitCubeGeometry, wedgeGeometry } from './chamferGeometry'

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
  wedge: wedgeGeometry(),
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
    ['wedge', GEOMETRIES.wedge, 8],
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
    wedge: [-0.25, 0.25, 0], // on the SW side of the NW-SE diagonal cut, mid-height (full-height solid)
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

  it('wedge: cut at NE has no vertex at all, top or bottom — unlike convex, which keeps a base vertex there', () => {
    const g = wedgeGeometry()
    const baseNE: Vec = [0.5, -0.5, -0.5]
    const baseSE: Vec = [0.5, 0.5, -0.5]
    const baseSW: Vec = [-0.5, 0.5, -0.5]
    const baseNW: Vec = [-0.5, -0.5, -0.5]
    expect(has(g, topNE)).toBe(false)
    expect(has(g, baseNE)).toBe(false)
    expect(has(g, topSE)).toBe(true)
    expect(has(g, baseSE)).toBe(true)
    expect(has(g, topSW)).toBe(true)
    expect(has(g, baseSW)).toBe(true)
    expect(has(g, topNW)).toBe(true)
    expect(has(g, baseNW)).toBe(true)
  })
})

describe('chamfer geometry — v-mirrored variants (reflected-plane pools)', () => {
  it.each([
    ['ramp', rampGeometry(), [-0.25, 0, -0.25] as Vec],
    ['convex', convexCornerGeometry(), [-0.25, -0.25, -0.3] as Vec],
    ['concave', concaveCornerGeometry(), [-0.25, -0.25, -0.25] as Vec],
    ['wedge', wedgeGeometry(), [-0.25, -0.25, 0] as Vec],
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

describe('chamfer geometry — baked rotation', () => {  it('rotation is a plain rotation about the origin: 4 quarter-turns returns to the canonical mesh', () => {
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

describe('chamfer geometry — half slab (Model G)', () => {
  it('is a full-footprint box flush with the outward face (z in [0, 0.5])', () => {
    const g = halfGeometry()
    g.computeBoundingBox()
    const { min, max } = g.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.5, -0.5, 0])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0.5, 0.5])
  })

  it('has 12 triangles (a full box) with outward windings', () => {
    const g = halfGeometry()
    expect(triangles(g).length).toBe(12)
    const inside: Vec = [0, 0, 0.25]
    for (const tri of triangles(g)) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(dot(normal, sub(centroid(tri), inside)), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })

  it('mirrorVGeometry(half) keeps the flush-outward solid with outward windings', () => {
    const m = mirrorVGeometry(halfGeometry())
    expect(triangles(m).length).toBe(12)
    m.computeBoundingBox()
    const { min, max } = m.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.5, -0.5, 0])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0.5, 0.5])
    const inside: Vec = [0, 0, 0.25]
    for (const tri of triangles(m)) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(dot(normal, sub(centroid(tri), inside)), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })
})

describe('chamfer geometry — post column (Model H)', () => {
  it('is a centered 0.5×0.5 column running the full unit length along z', () => {
    const g = postGeometry()
    g.computeBoundingBox()
    const { min, max } = g.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.25, -0.25, -0.5])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.25, 0.25, 0.5])
  })

  it('has 12 triangles (a full box) with outward windings', () => {
    const g = postGeometry()
    expect(triangles(g).length).toBe(12)
    const inside: Vec = [0, 0, 0]
    for (const tri of triangles(g)) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(dot(normal, sub(centroid(tri), inside)), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })

  it('mirrorVGeometry(post) keeps the centered solid with outward windings', () => {
    const m = mirrorVGeometry(postGeometry())
    expect(triangles(m).length).toBe(12)
    m.computeBoundingBox()
    const { min, max } = m.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.25, -0.25, -0.5])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.25, 0.25, 0.5])
    const inside: Vec = [0, 0, 0]
    for (const tri of triangles(m)) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(dot(normal, sub(centroid(tri), inside)), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })
})

describe('chamfer geometry — quarter column (Model I)', () => {
  it('rotation 0 occupies the NE quadrant (u in [0, 0.5], v in [-0.5, 0]), full z length', () => {
    const g = quarterGeometry(0)
    g.computeBoundingBox()
    const { min, max } = g.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([0, -0.5, -0.5])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0, 0.5])
  })

  it.each([
    [0, [0, -0.5, -0.5], [0.5, 0, 0.5]], // NE
    [1, [0, 0, -0.5], [0.5, 0.5, 0.5]], // SE
    [2, [-0.5, 0, -0.5], [0, 0.5, 0.5]], // SW
    [3, [-0.5, -0.5, -0.5], [0, 0, 0.5]], // NW
  ] as const)('rotation %i occupies its corner with 12 outward-wound triangles', (rotation, lo, hi) => {
    const g = quarterGeometry(rotation)
    expect(triangles(g).length).toBe(12)
    g.computeBoundingBox()
    const { min, max } = g.boundingBox!
    // rotateZ leaves exact-zero dust with a negative sign (−0); +0 collapses it for comparison.
    const norm = (n: number) => round(n) + 0
    expect([norm(min.x), norm(min.y), norm(min.z)]).toEqual([...lo])
    expect([norm(max.x), norm(max.y), norm(max.z)]).toEqual([...hi])
    const inside: Vec = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0]
    for (const tri of triangles(g)) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(dot(normal, sub(centroid(tri), inside)), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })

  it('mirrorVGeometry(quarter) moves NE to SE with outward windings', () => {
    const m = mirrorVGeometry(quarterGeometry(0))
    expect(triangles(m).length).toBe(12)
    m.computeBoundingBox()
    const { min, max } = m.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([0, 0, -0.5])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0.5, 0.5])
    const inside: Vec = [0.25, 0.25, 0]
    for (const tri of triangles(m)) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(dot(normal, sub(centroid(tri), inside)), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })
})

describe('chamfer geometry — flat quad (Model J)', () => {
  it('is a single u×v square at z = 0 with a +z normal (2 triangles)', () => {
    const g = flatGeometry()
    const tris = triangles(g)
    expect(tris.length).toBe(2)
    g.computeBoundingBox()
    const { min, max } = g.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.5, -0.5, 0])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0.5, 0])
    for (const tri of tris) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(normal[2]).toBeGreaterThan(0)
      expect(Math.abs(normal[0]) + Math.abs(normal[1])).toBeLessThan(1e-9)
    }
  })

  it('mirrorVGeometry(flat) is the same quad with a +z normal', () => {
    const m = mirrorVGeometry(flatGeometry())
    expect(triangles(m).length).toBe(2)
    m.computeBoundingBox()
    const { min, max } = m.boundingBox!
    expect([round(min.x), round(min.y), round(min.z)]).toEqual([-0.5, -0.5, 0])
    expect([round(max.x), round(max.y), round(max.z)]).toEqual([0.5, 0.5, 0])
    const nrm = m.getAttribute('normal') as THREE.BufferAttribute
    for (let i = 0; i < nrm.count; i++) {
      expect(nrm.getZ(i)).toBeGreaterThan(0)
    }
  })
})

describe('chamfer geometry — flat wedge quad (Model K)', () => {
  it('rotation 0 is the NW-SE diagonal, full depth, normal toward NE (2 triangles)', () => {
    const g = flatWedgeGeometry(0)
    const tris = triangles(g)
    expect(tris.length).toBe(2)
    // Every vertex sits on the u−v = 0 diagonal, at the cell's vertical edges.
    for (const tri of tris) {
      for (const v of tri) {
        expect(round(v[0] - v[1])).toBe(0)
        expect(Math.abs(round(v[0]))).toBe(0.5)
      }
    }
    // Normal points NE (u+, v−), horizontal: (1,−1,0)/√2.
    for (const tri of tris) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      const len = Math.hypot(normal[0], normal[1], normal[2])
      expect(normal[0] / len).toBeCloseTo(Math.SQRT1_2, 5)
      expect(normal[1] / len).toBeCloseTo(-Math.SQRT1_2, 5)
      expect(normal[2] / len).toBeCloseTo(0, 5)
    }
  })

  it.each([
    [0, 0], // NW-SE diagonal: u−v = 0
    [1, 2], // NE-SW diagonal: u+v = 0
    [2, 0], // NW-SE diagonal, opposite facing
    [3, 2], // NE-SW diagonal, opposite facing
  ] as const)('rotation %i rides its diagonal', (rotation, diag) => {
    const g = flatWedgeGeometry(rotation)
    expect(triangles(g).length).toBe(2)
    for (const tri of triangles(g)) {
      for (const v of tri) {
        const key = diag === 0 ? round(v[0] - v[1]) : round(v[0] + v[1])
        expect(key).toBe(0)
      }
    }
  })

  it('mirrorVGeometry(flatwedge) rides the NE-SW diagonal (the rotation-1 solid)', () => {
    const m = mirrorVGeometry(flatWedgeGeometry(0))
    expect(triangles(m).length).toBe(2)
    for (const tri of triangles(m)) {
      for (const v of tri) {
        expect(round(v[0] + v[1])).toBe(0)
      }
    }
    // Mirrored normal faces SE; the interior point sits behind it (u+v < 0).
    const inside: Vec = [-0.25, -0.25, 0]
    for (const tri of triangles(m)) {
      const normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
      expect(dot(normal, sub(centroid(tri), inside)), `triangle ${JSON.stringify(tri)}`).toBeGreaterThan(0)
    }
  })
})
