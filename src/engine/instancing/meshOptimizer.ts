import * as THREE from 'three'
import earcut from 'earcut'
import ThreeBSP from '@/engine/csg/ThreeCSG'
import type { MaterialClass } from '@/engine/palette/palette'

const COPLANAR_THRESHOLD = 1e-5
const NORMAL_THRESHOLD = 0.9999
const VERTEX_PRECISION = 1e6

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
 */
export function optimizeGroupsByCSG(groups: VoxelGroup[]): ColorGroupGeometry[] {
  const results: ColorGroupGeometry[] = []

  for (const group of groups) {
    if (group.geometries.length === 0) continue

    const bsps: ThreeBSP[] = []
    for (const geom of group.geometries) {
      bsps.push(new ThreeBSP(geom))
    }

    const merged = unionAll(bsps)
    if (merged) {
      const csgGeom = merged.toGeometry()
      const optimized = mergeCoplanarFaces(toNonIndexed(csgGeom))
      csgGeom.dispose()
      results.push({
        colorKey: group.colorKey,
        materialClass: group.materialClass,
        geometry: optimized,
      })
    }
  }

  return results
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

function orderBoundaryVertices(vertices: THREE.Vector3[], edges: Map<string, number>): THREE.Vector3[] {
  if (vertices.length <= 3) return vertices

  const adjacency = new Map<string, string[]>()
  for (const [key, count] of edges.entries()) {
    if (count !== 1) continue
    const [a, b] = key.split('|')
    if (!adjacency.has(a)) adjacency.set(a, [])
    if (!adjacency.has(b)) adjacency.set(b, [])
    adjacency.get(a)!.push(b)
    adjacency.get(b)!.push(a)
  }

  const byKey = new Map<string, THREE.Vector3>()
  for (const v of vertices) byKey.set(vertexKey(v), v)

  const ordered: THREE.Vector3[] = []
  const visited = new Set<string>()
  let currentKey: string | null = vertexKey(vertices[0])

  while (currentKey && ordered.length < vertices.length) {
    visited.add(currentKey)
    ordered.push(byKey.get(currentKey)!)
    const next: string | undefined = (adjacency.get(currentKey) ?? []).find((n) => !visited.has(n))
    currentKey = next ?? null
  }

  return ordered.length >= 3 ? ordered : vertices
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

function mergeCoplanarTriangles(triangles: Tri[]): Tri[] {
  if (triangles.length <= 1) return triangles

  const vertexMap = new Map<string, THREE.Vector3>()
  const edges = new Map<string, number>()

  for (const tri of triangles) {
    for (const v of tri.vertices) {
      const key = vertexKey(v)
      if (!vertexMap.has(key)) vertexMap.set(key, v)
    }
    for (let i = 0; i < 3; i++) {
      const key = edgeKey(tri.vertices[i], tri.vertices[(i + 1) % 3])
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }

  const boundaryEdges = new Map<string, [THREE.Vector3, THREE.Vector3]>()
  for (const [key, count] of edges.entries()) {
    if (count !== 1) continue
    const [k1, k2] = key.split('|')
    boundaryEdges.set(key, [vertexMap.get(k1)!, vertexMap.get(k2)!])
  }

  const boundaryLoops: THREE.Vector3[][] = []
  const usedEdges = new Set<string>()

  for (const [startKey] of boundaryEdges.entries()) {
    if (usedEdges.has(startKey)) continue

    const loopEdges = new Map<string, [THREE.Vector3, THREE.Vector3]>()
    const toProcess = [startKey]
    while (toProcess.length > 0) {
      const current = toProcess.pop()!
      if (usedEdges.has(current)) continue
      usedEdges.add(current)
      const edge = boundaryEdges.get(current)!
      loopEdges.set(current, edge)

      const [v1, v2] = edge
      for (const [otherKey, [ov1, ov2]] of boundaryEdges.entries()) {
        if (usedEdges.has(otherKey)) continue
        if (
          vertexKey(v1) === vertexKey(ov1) || vertexKey(v1) === vertexKey(ov2) ||
          vertexKey(v2) === vertexKey(ov1) || vertexKey(v2) === vertexKey(ov2)
        ) {
          toProcess.push(otherKey)
        }
      }
    }

    const loopVertexKeys = new Set<string>()
    for (const [a, b] of loopEdges.values()) {
      loopVertexKeys.add(vertexKey(a))
      loopVertexKeys.add(vertexKey(b))
    }
    const loopVertices = Array.from(loopVertexKeys).map((k) => vertexMap.get(k)!)
    const ordered = orderBoundaryVertices(loopVertices, edges)
    if (ordered.length >= 3) boundaryLoops.push(ordered)
  }

  if (boundaryLoops.length === 0) return triangles

  const reference = triangles[0]
  const normal = reference.normal

  const tangent = new THREE.Vector3(1, 0, 0)
  if (Math.abs(normal.dot(tangent)) > 0.9) tangent.set(0, 1, 0)
  tangent.sub(normal.clone().multiplyScalar(normal.dot(tangent))).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()

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
