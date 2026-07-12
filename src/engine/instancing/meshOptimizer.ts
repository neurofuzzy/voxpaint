import * as THREE from 'three'
import earcut from 'earcut'

/**
 * Coplanar-face mesh optimizer, adapted from zanpo-brick-designer's `mesh-optimizer.ts`.
 *
 * Merges coplanar, edge-connected, same-color triangles into larger polygons and re-triangulates
 * them (earcut), cutting the triangle count on flat surfaces (a merged voxel wall becomes a few big
 * quads instead of hundreds of unit triangles). Operates on a **non-indexed, flat-shaded**
 * geometry carrying `position`, `normal`, and a single-float `colorKey` (packed `0xRRGGBB`, from
 * VoxPaint's palette) used both as the material-match key — so faces of different colors never merge
 * — and to reconstruct the output `color` vertex attribute. Output geometry: `position`, `normal`,
 * `color`.
 */

const COPLANAR_THRESHOLD = 1e-5
const NORMAL_THRESHOLD = 0.9999 // ~0.8 degrees
const VERTEX_PRECISION = 1e6

interface Tri {
  normal: THREE.Vector3
  plane: THREE.Plane
  vertices: THREE.Vector3[]
  colorKey: number
}

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

/** Order a loop's vertices into a continuous ring by walking the boundary-edge adjacency graph. */
function orderBoundaryVertices(vertices: THREE.Vector3[], edges: Map<string, number>): THREE.Vector3[] {
  if (vertices.length <= 3) return vertices

  const adjacency = new Map<string, string[]>()
  for (const [key, count] of edges.entries()) {
    if (count !== 1) continue // boundary edges only
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

/** Drop collinear vertices (interior points of straight boundary runs). */
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

/** Merge one coplanar+connected+same-color triangle group into a re-triangulated polygon. */
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

  // Boundary edges appear exactly once; group them into connected loops (outer boundary + holes).
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

  const finalLoops = boundaryLoops
    .map((loop) => {
      const simplified = simplifyCollinearVertices(loop)
      return simplified.length >= 3 ? simplified : loop
    })
    .filter((loop) => loop.length >= 3)

  // Build a right-handed 2D basis on the plane for triangulation.
  const tangent = new THREE.Vector3(1, 0, 0)
  if (Math.abs(normal.dot(tangent)) > 0.9) tangent.set(0, 1, 0)
  tangent.sub(normal.clone().multiplyScalar(normal.dot(tangent))).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()

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

  const indices = earcut(coords2D, holeIndices.length > 0 ? holeIndices : undefined)
  if (indices.length === 0) return triangles // earcut failed — keep originals

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

    // Earcut is CCW in 2D; mapping back to 3D can flip winding — fix against the reference normal.
    const vertices = calcNormal.dot(normal) < -0.5 ? [v0, v2, v1] : [v0, v1, v2]
    out.push({ vertices, normal: normal.clone(), plane: reference.plane, colorKey: reference.colorKey })
  }

  return out.length > 0 ? out : triangles
}

function buildGeometryFromTriangles(triangles: Tri[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const color = new THREE.Color()

  for (const tri of triangles) {
    color.setHex(tri.colorKey)
    for (let i = 0; i < 3; i++) {
      const v = tri.vertices[i]
      positions.push(v.x, v.y, v.z)
      normals.push(tri.normal.x, tri.normal.y, tri.normal.z)
      colors.push(color.r, color.g, color.b)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

/** Triangle count of a (non-indexed or indexed) geometry. */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex()
  if (index) return index.count / 3
  const pos = geometry.getAttribute('position')
  return pos ? pos.count / 3 : 0
}

/**
 * Merge coplanar, connected, same-`colorKey` faces. Input must be non-indexed with `position`,
 * `normal`, and `colorKey` attributes (see module doc). Returns a new geometry; the input is not
 * mutated.
 */
export function optimizeGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const colorKeyAttr = geometry.getAttribute('colorKey') as THREE.BufferAttribute | undefined
  if (!positionAttr || !normalAttr || !colorKeyAttr) return geometry

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
      colorKey: colorKeyAttr.getX(i0),
    })
  }

  // Group by coplanarity + color + connectivity (greedy union into edge-connected coplanar groups).
  const groups: Tri[][] = []
  for (const tri of triangles) {
    let placed = false
    for (const group of groups) {
      const head = group[0]
      if (tri.normal.dot(head.normal) <= NORMAL_THRESHOLD) continue
      if (Math.abs(head.plane.distanceToPoint(tri.vertices[0])) > COPLANAR_THRESHOLD) continue
      if (tri.colorKey !== head.colorKey) continue
      if (!group.some((g) => trianglesShareEdge(tri, g))) continue
      group.push(tri)
      placed = true
      break
    }
    if (!placed) groups.push([tri])
  }

  const optimized: Tri[] = []
  for (const group of groups) {
    if (group.length === 1) optimized.push(group[0])
    else optimized.push(...mergeCoplanarTriangles(group))
  }

  return buildGeometryFromTriangles(optimized)
}
