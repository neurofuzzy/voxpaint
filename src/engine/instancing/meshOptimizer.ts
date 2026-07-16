import * as THREE from 'three'
import earcut from 'earcut'
import ThreeBSP from '@/engine/csg/ThreeCSG'
import type { MaterialClass } from '@/engine/palette/palette'

const COPLANAR_THRESHOLD = 1e-5
const NORMAL_THRESHOLD = 0.9999
const VERTEX_PRECISION = 1e6;

interface Tri {
  normal: THREE.Vector3
  plane: THREE.Plane
  vertices: THREE.Vector3[]
}

/**
 * CSG-based mesh optimizer. Groups per-voxel closed (watertight) solid geometries by
 * (materialClass, colorKey), then binary-tree-unions each group through ThreeBSP. The CSG
 * boolean union naturally discards interior faces between adjacent same-colour voxels while
 * preserving disconnected components without accidental edge-sharing bridges.
 *
 * Because colour separation happens *before* unioning, adjacent voxels of different colours
 * keep their shared interface faces. Each result group carries a single `colorKey` and
 * `materialClass` — the consumer creates one solid-colour material (no vertex colors needed).
 */

export interface VoxelGroup {
  colorKey: number
  materialClass: MaterialClass
  geometries: THREE.BufferGeometry[]
}

export interface ColorGroupGeometry {
  colorKey: number
  materialClass: MaterialClass
  geometry: THREE.BufferGeometry
}

/** Triangle count of a (non-indexed or indexed) geometry. */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex()
  if (index) return index.count / 3
  const pos = geometry.getAttribute('position')
  return pos ? pos.count / 3 : 0
}

/** Binary-tree reduction of many BSP trees into one via pairwise union. */
function unionAll(bsps: ThreeBSP[]): ThreeBSP | null {
  if (bsps.length === 0) return null
  let work = bsps
  while (work.length > 1) {
    const next: ThreeBSP[] = []
    for (let i = 0; i < work.length; i += 2) {
      if (i + 1 < work.length) {
        next.push(work[i].union(work[i + 1]))
      } else {
        next.push(work[i])
      }
    }
    work = next
  }
  return work[0]
}

/**
 * For each `VoxelGroup`, transform every solid geometry into a ThreeBSP tree, binary-tree-union
 * them into a single watertight surface, run a coplanar-face merge pass to reduce triangle count,
 * and convert the result back to BufferGeometry. Each output entry carries the group's `colorKey`
 * and `materialClass` — the caller applies a solid-colour material (no vertex colors).
 *
 * `isOccupied`, when given, additionally strips any **glass** group's faces that back onto an
 * occupied grid cell (see `removeOccludedGlassFaces`) — right after the CSG union, before the
 * coplanar merge, while triangles still correspond ~1:1 to per-voxel faces.
 */
export function optimizeGroupsByCSG<T extends VoxelGroup>(
  groups: T[],
  mergeCoplanar = true,
  isOccupied?: (x: number, y: number, z: number) => boolean,
): (ColorGroupGeometry & Omit<T, keyof VoxelGroup>)[] {
  const results: (ColorGroupGeometry & Omit<T, keyof VoxelGroup>)[] = []

  for (const group of groups) {
    if (group.geometries.length === 0) continue

    const bsps: ThreeBSP[] = []
    for (const geom of group.geometries) {
      bsps.push(new ThreeBSP(geom))
    }

    const merged = unionAll(bsps)
    if (merged) {
      let csgGeom = toNonIndexed(merged.toGeometry())
      if (group.materialClass === 'glass' && isOccupied) {
        const culled = removeOccludedGlassFaces(csgGeom, isOccupied)
        csgGeom.dispose()
        csgGeom = culled
      }
      const optimized = mergeCoplanar ? mergeCoplanarFaces(csgGeom) : csgGeom
      if (mergeCoplanar) csgGeom.dispose()
      const { geometries: _geometries, colorKey, materialClass, ...rest } = group
      results.push({
        colorKey,
        materialClass,
        geometry: optimized,
        ...rest,
      } as ColorGroupGeometry & Omit<T, keyof VoxelGroup>)
    }
  }

  return results
}

/** CSG-unioned shell only — no coplanar-face merge. The default 3D-preview path. */
export function csgUnionGroups(groups: VoxelGroup[], isOccupied?: (x: number, y: number, z: number) => boolean): ColorGroupGeometry[] {
  return optimizeGroupsByCSG(groups, false, isOccupied)
}

/**
 * Strips triangles of a (post-CSG, pre-coplanar-merge) glass geometry whose outward side sits
 * against an occupied grid cell — e.g. glass built flush against a solid block, or two adjacent
 * glass voxels — so the glass doesn't z-fight or double up against whatever's behind it (mirrors
 * `removeInteriorFaces`'s "drop the glass face" rule for the textured shell path, see
 * `voxelMeshBuilder.ts`).
 *
 * Unlike `removeInteriorFaces`, this doesn't match triangles against a neighbouring group's
 * geometry (glass and its neighbours are never CSG-unioned together, so there's nothing to match
 * against without introducing an inter-group correlation this pipeline doesn't otherwise need).
 * Instead it's a **rough occupancy test**: sample the grid a half-cell past each triangle's own
 * centroid along its own outward normal and ask `isOccupied`. This is exact for axis-aligned cube
 * faces (the sample lands squarely in the neighbour cell) and an approximation for sloped chamfer
 * faces — acceptable here since a triangle at this pipeline stage still corresponds to ~one
 * original per-voxel face (CSG union only cancels *exactly* coincident coplanar faces within the
 * same material/colour group; it hasn't re-triangulated anything yet — that's `mergeCoplanarFaces`,
 * which runs after this).
 */
export function removeOccludedGlassFaces(
  geometry: THREE.BufferGeometry,
  isOccupied: (x: number, y: number, z: number) => boolean,
): THREE.BufferGeometry {
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute
  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute
  if (!positionAttr || !normalAttr) return geometry

  const triangleTotal = positionAttr.count / 3
  const positions: number[] = []
  const normals: number[] = []
  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const sample = new THREE.Vector3()

  for (let t = 0; t < triangleTotal; t++) {
    const i0 = t * 3
    v0.fromBufferAttribute(positionAttr, i0)
    v1.fromBufferAttribute(positionAttr, i0 + 1)
    v2.fromBufferAttribute(positionAttr, i0 + 2)
    normal.fromBufferAttribute(normalAttr, i0).normalize()

    sample.copy(v0).add(v1).add(v2).divideScalar(3).addScaledVector(normal, 0.5)
    if (isOccupied(Math.floor(sample.x), Math.floor(sample.y), Math.floor(sample.z))) continue

    for (const v of [v0, v1, v2]) {
      positions.push(v.x, v.y, v.z)
      normals.push(normal.x, normal.y, normal.z)
    }
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return out
}

// ── Coplanar-face merge (post-CSG triangle reduction) ─────────────────────

function vertexKey(v: THREE.Vector3): string {
  return `${Math.round(v.x * VERTEX_PRECISION)},${Math.round(v.y * VERTEX_PRECISION)},${Math.round(v.z * VERTEX_PRECISION)}`
}

function edgeKey(v1: THREE.Vector3, v2: THREE.Vector3): string {
  const k1 = vertexKey(v1)
  const k2 = vertexKey(v2)
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
}

function trianglesShareEdge(t1: Tri, t2: Tri): boolean {
  const edges2 = [
    edgeKey(t2.vertices[0], t2.vertices[1]),
    edgeKey(t2.vertices[1], t2.vertices[2]),
    edgeKey(t2.vertices[2], t2.vertices[0]),
  ]
  for (let i = 0; i < 3; i++) {
    if (edges2.includes(edgeKey(t1.vertices[i], t1.vertices[(i + 1) % 3]))) return true
  }
  return false
}

function simplifyCollinearVertices(vertices: THREE.Vector3[]): THREE.Vector3[] {
  if (vertices.length <= 3) return vertices
  const simplified: THREE.Vector3[] = []
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()

  for (let i = 0; i < vertices.length; i++) {
    const prev = vertices[(i - 1 + vertices.length) % vertices.length]
    const curr = vertices[i]
    const next = vertices[(i + 1) % vertices.length]
    edge1.subVectors(curr, prev).normalize()
    edge2.subVectors(next, curr).normalize()
    if (Math.abs(edge1.dot(edge2)) < NORMAL_THRESHOLD) simplified.push(curr)
  }
  return simplified.length >= 3 ? simplified : vertices
}

function groupsShareEdge(a: Tri[], b: Tri[]): boolean {
  for (const ta of a) {
    for (const tb of b) {
      if (trianglesShareEdge(ta, tb)) return true
    }
  }
  return false
}

function mergeConnectedGroups(groups: Tri[][]): Tri[][] {
  let changed = true
  let current = groups

  while (changed) {
    changed = false
    const next: Tri[][] = []
    const placed = new Set<number>()

    for (let i = 0; i < current.length; i++) {
      if (placed.has(i)) continue
      let group = current[i]
      placed.add(i)

      for (let j = i + 1; j < current.length; j++) {
        if (placed.has(j)) continue
        const head = current[j][0]
        if (group[0].normal.dot(head.normal) <= NORMAL_THRESHOLD) continue
        if (Math.abs(group[0].plane.distanceToPoint(head.vertices[0])) > COPLANAR_THRESHOLD) continue
        if (!groupsShareEdge(group, current[j])) continue
        group = [...group, ...current[j]]
        placed.add(j)
        changed = true
      }

      next.push(group)
    }

    current = next
  }

  return current
}

function signedArea2D(coords: number[], start: number, end: number): number {
  let area = 0
  const n = end - start
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += coords[(start + i) * 2] * coords[(start + j) * 2 + 1]
          - coords[(start + j) * 2] * coords[(start + i) * 2 + 1]
  }
  return area
}

/** Reverse the vertices of a single boundary loop in both `coords2D` and `allVertices`. */
function reverseLoop(coords2D: number[], allVertices: THREE.Vector3[], start: number, end: number): void {
  for (let i = 0; i < Math.floor((end - start) / 2); i++) {
    const a = start + i
    const b = end - 1 - i
    const a2 = a * 2
    const b2 = b * 2
    ;[coords2D[a2], coords2D[b2]] = [coords2D[b2], coords2D[a2]]
    ;[coords2D[a2 + 1], coords2D[b2 + 1]] = [coords2D[b2 + 1], coords2D[a2 + 1]]
    ;[allVertices[a], allVertices[b]] = [allVertices[b], allVertices[a]]
  }
}

/**
 * Earcut expects the first loop to be CCW (positive signed area) and every hole to be CW
 * (negative). The tangent/bitangent projection may invert winding for some normals; correct
 * any loop whose 2D winding doesn't match the expected parity.
 */
function ensureWinding(
  coords2D: number[],
  allVertices: THREE.Vector3[],
  starts: number[],
  ends: number[],
): void {
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    const end = ends[i]
    const area = signedArea2D(coords2D, start, end)
    // Positive area = CCW. Outer (i=0) must be CCW; holes must be CW (negative).
    const needsReverse = (i === 0) ? area < 0 : area > 0
    if (needsReverse) reverseLoop(coords2D, allVertices, start, end)
  }
}

/**
 * Extract oriented boundary loops from a set of coplanar, edge-connected triangles using directed
 * half-edges. Each triangle's directed edges follow its winding; an edge whose reverse is absent is
 * a boundary edge (interior edges appear once in each direction and cancel). Walking directed
 * boundary edges keeps the solid region on one consistent side, so the outer boundary and each hole
 * come out as separate loops.
 *
 * Crucially this handles **pinch vertices** — where an outer boundary and a hole boundary meet at a
 * single point because two solid cells touch only diagonally (e.g. a donut face whose ring closes
 * through one corner). Such a vertex has multiple outgoing boundary edges; we pick the next edge by
 * turning as far clockwise as possible from the reverse of the incoming edge (standard planar
 * face-traversal), which keeps the outer loop and the hole loop distinct instead of fusing them
 * into one — the latter would drop the hole and make earcut fill it.
 */
function extractBoundaryLoops(
  triangles: Tri[],
  proj: (v: THREE.Vector3) => [number, number],
): THREE.Vector3[][] {
  const vByKey = new Map<string, THREE.Vector3>()
  const dirSet = new Set<string>()
  for (const tri of triangles) {
    for (let i = 0; i < 3; i++) {
      const a = tri.vertices[i]
      const b = tri.vertices[(i + 1) % 3]
      const ak = vertexKey(a)
      const bk = vertexKey(b)
      vByKey.set(ak, a)
      vByKey.set(bk, b)
      dirSet.add(`${ak}>${bk}`)
    }
  }

  // Boundary directed edges (no reverse), grouped by their source vertex.
  const outgoing = new Map<string, string[]>()
  for (const d of dirSet) {
    const sep = d.indexOf('>')
    const ak = d.slice(0, sep)
    const bk = d.slice(sep + 1)
    if (dirSet.has(`${bk}>${ak}`)) continue // interior edge, skip
    if (!outgoing.has(ak)) outgoing.set(ak, [])
    outgoing.get(ak)!.push(bk)
  }

  // At vertex `vk` arriving from `uk`, choose the outgoing edge that turns most clockwise from the
  // reverse of the incoming direction — the first boundary edge hit rotating clockwise.
  const pickNext = (uk: string, vk: string, cands: string[]): string => {
    if (cands.length === 1) return cands[0]
    const [ux, uy] = proj(vByKey.get(uk)!)
    const [vx, vy] = proj(vByKey.get(vk)!)
    const rx = ux - vx // reverse of incoming: from v back toward u
    const ry = uy - vy
    let best = cands[0]
    let bestCw = Infinity
    for (const wk of cands) {
      const [wx, wy] = proj(vByKey.get(wk)!)
      const ox = wx - vx
      const oy = wy - vy
      const cross = rx * oy - ry * ox
      const dot = rx * ox + ry * oy
      let cw = -Math.atan2(cross, dot) // clockwise angle from r to out
      if (cw < 1e-9) cw += Math.PI * 2 // skip the reverse direction itself (~0)
      if (cw < bestCw) {
        bestCw = cw
        best = wk
      }
    }
    return best
  }

  const used = new Set<string>()
  const loops: THREE.Vector3[][] = []
  for (const startEdge of dirSet) {
    if (used.has(startEdge)) continue
    const sep = startEdge.indexOf('>')
    let fromK = startEdge.slice(0, sep)
    let toK = startEdge.slice(sep + 1)
    if (dirSet.has(`${toK}>${fromK}`)) continue // interior edge, not a loop start

    const loop: THREE.Vector3[] = []
    while (true) {
      const edge = `${fromK}>${toK}`
      if (used.has(edge)) break
      used.add(edge)
      loop.push(vByKey.get(fromK)!)
      const cands = (outgoing.get(toK) ?? []).filter((w) => !used.has(`${toK}>${w}`))
      if (cands.length === 0) break
      const nextK = pickNext(fromK, toK, cands)
      fromK = toK
      toK = nextK
    }
    if (loop.length >= 3) loops.push(loop)
  }

  return loops
}

function mergeCoplanarTriangles(triangles: Tri[]): Tri[] {
  if (triangles.length <= 1) return triangles

  const reference = triangles[0]
  const normal = reference.normal

  // 2D projection basis on the shared plane, right-handed w.r.t. the normal.
  const tangent = new THREE.Vector3(1, 0, 0)
  if (Math.abs(normal.dot(tangent)) > 0.9) tangent.set(0, 1, 0)
  tangent.sub(normal.clone().multiplyScalar(normal.dot(tangent))).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  const proj = (v: THREE.Vector3): [number, number] => [v.dot(tangent), v.dot(bitangent)]

  const boundaryLoops = extractBoundaryLoops(triangles, proj)
  if (boundaryLoops.length === 0) return triangles

  // Compute 2D bounding-box extent for each loop so we can sort outer first
  // (discovery order is arbitrary; the outer loop has the largest extent).
  function loopExtent(loop: THREE.Vector3[]): number {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const v of loop) {
      const x = v.dot(tangent)
      const y = v.dot(bitangent)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    return (maxX - minX) * (maxY - minY)
  }

  const finalLoops = boundaryLoops
    .map((loop) => {
      const simplified = simplifyCollinearVertices(loop)
      return simplified.length >= 3 ? simplified : loop
    })
    .filter((loop) => loop.length >= 3)
    .sort((a, b) => loopExtent(b) - loopExtent(a))

  const coords2D: number[] = []
  const holeIndices: number[] = []
  const allVertices: THREE.Vector3[] = []

  for (let i = 0; i < finalLoops.length; i++) {
    if (i > 0) holeIndices.push(coords2D.length / 2)
    for (const v of finalLoops[i]) {
      coords2D.push(v.dot(tangent), v.dot(bitangent))
      allVertices.push(v)
    }
  }

  // Ensure correct winding for earcut — the 2D projection may invert winding
  // relative to what earcut expects (first loop CCW / positive area, holes CW / negative area).
  ensureWinding(coords2D, allVertices, [0, ...holeIndices], [...holeIndices, allVertices.length])

  const indices = earcut(coords2D, holeIndices.length > 0 ? holeIndices : undefined)
  if (indices.length === 0) return triangles

  const out: Tri[] = []
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const calcNormal = new THREE.Vector3()

  for (let i = 0; i < indices.length; i += 3) {
    const v0 = allVertices[indices[i]]
    const v1 = allVertices[indices[i + 1]]
    const v2 = allVertices[indices[i + 2]]
    e1.subVectors(v1, v0)
    e2.subVectors(v2, v0)
    calcNormal.crossVectors(e1, e2)
    if (calcNormal.lengthSq() > 0) calcNormal.normalize()

    const vertices = calcNormal.dot(normal) < -0.5 ? [v0, v2, v1] : [v0, v1, v2]
    out.push({ vertices, normal: normal.clone(), plane: reference.plane })
  }

  return out.length > 0 ? out : triangles
}

function toNonIndexed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometry.getIndex()) return geometry
  return geometry.toNonIndexed()
}

/** Merge coplanar edge-connected faces on a post-CSG geometry to reduce triangle count. */
function mergeCoplanarFaces(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute
  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute
  if (!positionAttr || !normalAttr) return geometry

  const triangleTotal = positionAttr.count / 3
  const triangles: Tri[] = []

  for (let t = 0; t < triangleTotal; t++) {
    const i0 = t * 3
    const v0 = new THREE.Vector3().fromBufferAttribute(positionAttr, i0)
    const v1 = new THREE.Vector3().fromBufferAttribute(positionAttr, i0 + 1)
    const v2 = new THREE.Vector3().fromBufferAttribute(positionAttr, i0 + 2)
    const normal = new THREE.Vector3().fromBufferAttribute(normalAttr, i0).normalize()
    triangles.push({
      normal,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, v0),
      vertices: [v0, v1, v2],
    })
  }

  const groups: Tri[][] = []
  for (const tri of triangles) {
    let placed = false
    for (const group of groups) {
      const head = group[0]
      if (tri.normal.dot(head.normal) <= NORMAL_THRESHOLD) continue
      if (Math.abs(head.plane.distanceToPoint(tri.vertices[0])) > COPLANAR_THRESHOLD) continue
      if (!group.some((g) => trianglesShareEdge(tri, g))) continue
      group.push(tri)
      placed = true
      break
    }
    if (!placed) groups.push([tri])
  }

  const merged = mergeConnectedGroups(groups)

  const optimized: Tri[] = []
  for (const group of merged) {
    if (group.length === 1) optimized.push(group[0])
    else optimized.push(...mergeCoplanarTriangles(group))
  }

  const positions: number[] = []
  const normals: number[] = []
  for (const tri of optimized) {
    for (const v of tri.vertices) {
      positions.push(v.x, v.y, v.z)
      normals.push(tri.normal.x, tri.normal.y, tri.normal.z)
    }
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return out
}
