import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import type { Coord, VoxelModel } from '@/engine/grid/types'
import { concaveCornerGeometry, convexCornerGeometry, mirrorVGeometry, rampGeometry } from '@/engine/chamfer/chamferGeometry'
import { resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { chamferBasisIsReflected, chamferInstanceMatrix } from './basis'
import { optimizeGeometry, triangleCount } from './meshOptimizer'

/**
 * Bakes the whole model into a single optimized "shell" mesh for the 3D preview's optimized-mesh
 * mode: it emits per-cell faces, removes back-to-back interior faces (the shell pass — hidden faces
 * where two solid voxels touch), then merges the surviving coplanar same-color faces
 * (`meshOptimizer.ts`). The result carries per-vertex `color` from each cell's palette slot.
 *
 * Plain cubes are emitted through `pushQuad`, which splits every face on a canonical diagonal so a
 * cube's face and its neighbour's coincident face are identical vertex-triples — that's what lets
 * the shell pass cancel them. Chamfer cells reuse the prefab geometry (transformed by the same
 * instance matrix the renderer uses); their interior faces cancel too when triangulation coincides,
 * otherwise they stay hidden inside the solid (harmless).
 */

interface Face {
  a: THREE.Vector3
  b: THREE.Vector3
  c: THREE.Vector3
  normal: THREE.Vector3
  colorKey: number
}

const QUANT = 1e6
const qkey = (v: THREE.Vector3) => `${Math.round(v.x * QUANT)},${Math.round(v.y * QUANT)},${Math.round(v.z * QUANT)}`

// Chamfer prefab geometries (non-indexed, CCW-outward), keyed by shapeKind + mirrored variant.
const CHAMFER_BASE: Record<string, THREE.BufferGeometry> = (() => {
  const ramp = rampGeometry(0)
  const convex = convexCornerGeometry(0)
  const concave = concaveCornerGeometry(0)
  return {
    ramp,
    convex,
    concave,
    rampM: mirrorVGeometry(ramp),
    convexM: mirrorVGeometry(convex),
    concaveM: mirrorVGeometry(concave),
  }
})()

function faceNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a)).normalize()
}

/** Add one triangle, orienting its winding so its normal agrees with `outward` (if given). */
function addTri(faces: Face[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colorKey: number, outward?: THREE.Vector3) {
  let n = faceNormal(a, b, c)
  if (n.lengthSq() === 0) return // degenerate
  if (outward && n.dot(outward) < 0) {
    ;[b, c] = [c, b]
    n = n.negate()
  }
  faces.push({ a, b, c, normal: n, colorKey })
}

/** Emit a quad as two triangles split on a canonical diagonal (min→max corner), so coincident
 * faces from adjacent cells produce identical vertex-triples for the shell pass. */
function pushQuad(faces: Face[], corners: THREE.Vector3[], outward: THREE.Vector3, colorKey: number) {
  const s = [...corners].sort((p, q) => qkey(p).localeCompare(qkey(q), undefined, { numeric: true }))
  addTri(faces, s[0], s[1], s[3], colorKey, outward)
  addTri(faces, s[0], s[3], s[2], colorKey, outward)
}

function emitCube(faces: Face[], [x, y, z]: Coord, colorKey: number) {
  const x1 = x + 1
  const y1 = y + 1
  const z1 = z + 1
  const P = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz)
  // 6 axis-aligned faces, each with its outward normal.
  pushQuad(faces, [P(x, y, z), P(x, y1, z), P(x, y1, z1), P(x, y, z1)], new THREE.Vector3(-1, 0, 0), colorKey)
  pushQuad(faces, [P(x1, y, z), P(x1, y1, z), P(x1, y1, z1), P(x1, y, z1)], new THREE.Vector3(1, 0, 0), colorKey)
  pushQuad(faces, [P(x, y, z), P(x1, y, z), P(x1, y, z1), P(x, y, z1)], new THREE.Vector3(0, -1, 0), colorKey)
  pushQuad(faces, [P(x, y1, z), P(x1, y1, z), P(x1, y1, z1), P(x, y1, z1)], new THREE.Vector3(0, 1, 0), colorKey)
  pushQuad(faces, [P(x, y, z), P(x1, y, z), P(x1, y1, z), P(x, y1, z)], new THREE.Vector3(0, 0, -1), colorKey)
  pushQuad(faces, [P(x, y, z1), P(x1, y, z1), P(x1, y1, z1), P(x, y1, z1)], new THREE.Vector3(0, 0, 1), colorKey)
}

function emitChamfer(faces: Face[], base: THREE.BufferGeometry, matrix: THREE.Matrix4, colorKey: number) {
  const pos = base.getAttribute('position')
  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(matrix)
    const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(matrix)
    const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(matrix)
    addTri(faces, a, b, c, colorKey) // prefab is CCW-outward and the matrix is det+1, so winding holds
  }
}

/**
 * Shell pass: drop back-to-back interior face pairs. Two faces with the same (order-independent)
 * quantized vertex-triple and opposing normals are the touching sides of two adjacent voxels — both
 * are hidden, so remove both. Everything else (boundary faces, non-coincident faces) is kept.
 */
export function removeInteriorFaces(faces: Face[]): Face[] {
  const byTri = new Map<string, number[]>()
  faces.forEach((f, i) => {
    const key = [qkey(f.a), qkey(f.b), qkey(f.c)].sort().join('|')
    const arr = byTri.get(key)
    if (arr) arr.push(i)
    else byTri.set(key, [i])
  })

  const removed = new Set<number>()
  for (const idxs of byTri.values()) {
    if (idxs.length !== 2) continue
    const [i, j] = idxs
    if (faces[i].normal.dot(faces[j].normal) < -0.9) {
      removed.add(i)
      removed.add(j)
    }
  }

  return faces.filter((_, i) => !removed.has(i))
}

function geometryFromFaces(faces: Face[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colorKeys: number[] = []
  for (const f of faces) {
    for (const v of [f.a, f.b, f.c]) {
      positions.push(v.x, v.y, v.z)
      normals.push(f.normal.x, f.normal.y, f.normal.z)
      colorKeys.push(f.colorKey)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('colorKey', new THREE.Float32BufferAttribute(colorKeys, 1))
  return geometry
}

export interface OptimizedVoxelMesh {
  geometry: THREE.BufferGeometry
  rawTriangles: number // faces emitted before the shell pass (full instanced geometry)
  optimizedTriangles: number // faces after shell cull + coplanar merge
}

/** Build the merged, shell-culled, coplanar-optimized mesh for the whole model. */
export function buildOptimizedVoxelGeometry(model: VoxelModel, palette: PaletteState): OptimizedVoxelMesh {
  const faces: Face[] = []
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()

  for (const key of model.color.keys()) {
    const coord = decodeKey(key)
    const colorKey = color.set(resolveSlotColor(palette, model.color.get(key)!.paletteSlot)).getHex()
    const chamfer = model.chamfer.get(key)

    if (chamfer?.resolvedTo) {
      const variant = chamferBasisIsReflected(chamfer.planeAxis, chamfer.planeOrientation) ? 'M' : ''
      const base = CHAMFER_BASE[`${chamfer.resolvedTo.shapeKind}${variant}`]
      chamferInstanceMatrix(coord, chamfer.planeAxis, chamfer.planeOrientation, chamfer.resolvedTo.rotation, matrix)
      emitChamfer(faces, base, matrix, colorKey)
    } else {
      emitCube(faces, coord, colorKey)
    }
  }

  const rawTriangles = faces.length
  const shell = removeInteriorFaces(faces)
  const geometry = optimizeGeometry(geometryFromFaces(shell))
  return { geometry, rawTriangles, optimizedTriangles: triangleCount(geometry) }
}
