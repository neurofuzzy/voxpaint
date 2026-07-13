import * as THREE from 'three'

const TEXELS_PER_UNIT = 4
const PADDING = 1
const NORMAL_THRESHOLD = 0.9999
const VERTEX_PRECISION = 1e6

interface Face {
  v0: THREE.Vector3
  v1: THREE.Vector3
  v2: THREE.Vector3
  normal: THREE.Vector3
  /** Index into the parent geometry's face list (0-based: vertex index / 3). */
  index: number
}

export interface UnwrappedRect {
  normal: THREE.Vector3
  tangent1: THREE.Vector3
  tangent2: THREE.Vector3
  depthCoord: number
  minU: number
  maxU: number
  minV: number
  maxV: number
  faceIndices: number[]
  atlasX: number
  atlasY: number
  texWidth: number
  texHeight: number
}

export interface UnwrappedAtlas {
  rects: UnwrappedRect[]
  size: number
}

function vkey(v: THREE.Vector3): string {
  return `${Math.round(v.x * VERTEX_PRECISION)},${Math.round(v.y * VERTEX_PRECISION)},${Math.round(v.z * VERTEX_PRECISION)}`
}

function edgeKey(a: THREE.Vector3, b: THREE.Vector3): string {
  const ka = vkey(a)
  const kb = vkey(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

function tangentAxes(normal: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const t1 = new THREE.Vector3(1, 0, 0)
  if (Math.abs(normal.dot(t1)) > 0.9) t1.set(0, 1, 0)
  t1.sub(normal.clone().multiplyScalar(normal.dot(t1))).normalize()
  const t2 = new THREE.Vector3().crossVectors(normal, t1).normalize()
  return [t1, t2]
}

function parseFaces(geometry: THREE.BufferGeometry): Face[] {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const nrm = geometry.getAttribute('normal') as THREE.BufferAttribute
  const faces: Face[] = []
  for (let i = 0; i < pos.count; i += 3) {
    faces.push({
      v0: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)),
      v1: new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)),
      v2: new THREE.Vector3(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)),
      normal: new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)),
      index: i / 3,
    })
  }
  return faces
}

function normalKey(n: THREE.Vector3): string {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  if (ax >= ay && ax >= az) return n.x > 0 ? '+x' : '-x'
  if (ay >= ax && ay >= az) return n.y > 0 ? '+y' : '-y'
  return n.z > 0 ? '+z' : '-z'
}

function findConnectedComponents(faces: Face[]): Face[][] {
  const byNormal = new Map<string, Face[]>()
  for (const f of faces) {
    const nk = normalKey(f.normal)
    const arr = byNormal.get(nk)
    if (arr) arr.push(f)
    else byNormal.set(nk, [f])
  }

  const groups: Face[][] = []
  for (const [, subset] of byNormal) {
    const edgesByFace = subset.map((f) => new Set([edgeKey(f.v0, f.v1), edgeKey(f.v1, f.v2), edgeKey(f.v2, f.v0)]))

    const visited = new Set<number>()
    for (let start = 0; start < subset.length; start++) {
      if (visited.has(start)) continue
      const group: Face[] = []
      const stack = [start]
      while (stack.length > 0) {
        const idx = stack.pop()!
        if (visited.has(idx)) continue
        visited.add(idx)
        group.push(subset[idx])
        for (let other = 0; other < subset.length; other++) {
          if (visited.has(other)) continue
          if (subset[idx].normal.dot(subset[other].normal) < NORMAL_THRESHOLD) continue
          for (const e of edgesByFace[idx]) {
            if (edgesByFace[other].has(e)) {
              stack.push(other)
              break
            }
          }
        }
      }
      groups.push(group)
    }
  }

  return groups
}

function componentToRect(faces: Face[]): UnwrappedRect {
  const normal = faces[0].normal.clone()
  const [t1, t2] = tangentAxes(normal)
  const depthCoord = faces[0].v0.dot(normal)

  let minU = Infinity, maxU = -Infinity
  let minV = Infinity, maxV = -Infinity

  for (const f of faces) {
    for (const v of [f.v0, f.v1, f.v2]) {
      const u = v.dot(t1)
      const vv = v.dot(t2)
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (vv < minV) minV = vv
      if (vv > maxV) maxV = vv
    }
  }

  const texWidth = Math.ceil((maxU - minU) * TEXELS_PER_UNIT) + PADDING * 2
  const texHeight = Math.ceil((maxV - minV) * TEXELS_PER_UNIT) + PADDING * 2

  return {
    normal,
    tangent1: t1,
    tangent2: t2,
    depthCoord,
    minU,
    maxU,
    minV,
    maxV,
    faceIndices: faces.map((f) => f.index),
    atlasX: 0,
    atlasY: 0,
    texWidth,
    texHeight,
  }
}

function packRects(rects: UnwrappedRect[]): number {
  const sorted = [...rects].sort((a, b) => b.texHeight - a.texHeight)
  if (sorted.length === 0) return 16

  let totalArea = 0
  for (const r of sorted) totalArea += r.texWidth * r.texHeight

  let size = 16
  while (size * size < totalArea * 1.5) size *= 2

  while (true) {
    const shelves: { y: number; height: number; usedX: number }[] = []
    let ok = true

    for (const r of sorted) {
      let placed = false
      for (const shelf of shelves) {
        if (r.texHeight <= shelf.height && shelf.usedX + r.texWidth <= size) {
          r.atlasX = shelf.usedX
          r.atlasY = shelf.y
          shelf.usedX += r.texWidth
          placed = true
          break
        }
      }
      if (!placed) {
        const newY = shelves.length > 0
          ? shelves[shelves.length - 1].y + shelves[shelves.length - 1].height
          : 0
        if (newY + r.texHeight > size) { ok = false; break }
        shelves.push({ y: newY, height: r.texHeight, usedX: r.texWidth })
        r.atlasX = 0
        r.atlasY = newY
      }
    }

    if (ok) break
    size *= 2
  }

  return size
}

export function unwrapGeometries(geometries: THREE.BufferGeometry[]): {
  atlas: UnwrappedAtlas
  uv1Arrays: Float32Array[]
} {
  const allFaces: Face[][] = geometries.map((g) => parseFaces(g))
  const allRects: (UnwrappedRect & { geomIdx: number })[] = []

  for (let gi = 0; gi < allFaces.length; gi++) {
    const components = findConnectedComponents(allFaces[gi])
    for (const comp of components) {
      const rect = componentToRect(comp)
      allRects.push({ ...rect, geomIdx: gi })
    }
  }

  const rects: UnwrappedRect[] = allRects
  const size = packRects(rects)

  const uv1Arrays: Float32Array[] = geometries.map((g) => {
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    return new Float32Array(pos ? pos.count * 2 : 0)
  })

  for (const rect of allRects) {
    const faces = allFaces[rect.geomIdx]
    const uv1 = uv1Arrays[rect.geomIdx]

    for (const fi of rect.faceIndices) {
      const face = faces.find((f) => f.index === fi)
      if (!face) continue

      const baseIdx = fi * 3

      const verts = [face.v0, face.v1, face.v2]
      for (let vi = 0; vi < 3; vi++) {
        const v = verts[vi]
        const u = v.dot(rect.tangent1)
        const vv = v.dot(rect.tangent2)
        const texU = PADDING + (u - rect.minU) * TEXELS_PER_UNIT
        const texV = PADDING + (vv - rect.minV) * TEXELS_PER_UNIT
        const outIdx = (baseIdx + vi) * 2
        uv1[outIdx] = (rect.atlasX + texU) / size
        uv1[outIdx + 1] = (rect.atlasY + texV) / size
      }
    }
  }

  return { atlas: { rects, size }, uv1Arrays }
}
