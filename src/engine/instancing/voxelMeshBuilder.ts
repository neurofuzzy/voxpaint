import * as THREE from 'three'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import type { CellKey, ChamferCell, Coord, VoxelModel } from '@/engine/grid/types'
import { concaveCornerGeometry, convexCornerGeometry, mirrorVGeometry, rampGeometry, wedgeGeometry } from '@/engine/chamfer/chamferGeometry'
import { materialClassFor, resolveSlotColor, type MaterialClass } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import type { SliceKey } from '@/engine/animation/types'
import { chamferBasisIsReflected, chamferInstanceMatrix } from './basis'
import { optimizeGroupsByCSG, triangleCount, type VoxelGroup } from './meshOptimizer'

/**
 * Bakes the whole model into a single optimized "shell" mesh for the 3D preview's optimized-mesh
 * mode: it emits per-cell faces, removes back-to-back interior faces (the shell pass — hidden faces
 * where two solid voxels touch), then merges the surviving coplanar same-color faces
 * (`meshOptimizer.ts`). The result carries per-vertex `color` from each cell's palette slot.
 *
 * Plain cubes are emitted through `pushQuad`, which splits every face on a canonical diagonal so a
 * cube's face and its neighbour's coincident face are identical vertex-triples — that's what lets
 * the shell pass cancel them. Chamfer cells reuse the prefab geometry (transformed by the same
 * instance matrix the renderer uses), but their flat quad faces (bottom, back walls, single-facet
 * ramp roof) are likewise re-split through `pushQuad` in `emitChamfer` so they too cancel against a
 * neighbour's coincident face — otherwise their prefab diagonal wouldn't match the neighbour's
 * canonical one, leaving a visible X of two facing quads. Genuinely triangular/folded faces remain.
 */

/** Per-cell material identity carried onto every face: RGB `colorKey` (packed sRGB hex) plus the
 * palette slot's `materialClass` (matte/emissive/metal/glass). Two faces belong to the same render/
 * export material only when both match. */
interface Mat {
  colorKey: number
  materialClass: MaterialClass
}

interface Face {
  a: THREE.Vector3
  b: THREE.Vector3
  c: THREE.Vector3
  normal: THREE.Vector3
  colorKey: number
  materialClass: MaterialClass
  /** The source chamfer cell when this face came from a resolved chamfer prefab, else undefined.
   * Only the box-map UV path reads it (to project a chamfer's faces along its authored axis). */
  chamfer?: ChamferCell
  /** The voxel cell this face was emitted from — tagged in `buildShellFaces`, read by the
   * animation-aware shell cull (`removeInteriorFaces`) and by-slice grouping. */
  cellKey?: CellKey
}

/**
 * Per-vertex box-map UV generator supplied by the texture layer. Takes the face's source chamfer
 * (undefined for plain cubes), its outward normal, and the world-space vertex; returns `[u, v]` in
 * atlas space. Kept as an injected callback so `engine/instancing` has no dependency on
 * `engine/texture`.
 */
export type VertexUV = (chamfer: ChamferCell | undefined, normal: THREE.Vector3, vertex: THREE.Vector3) => [number, number]

const QUANT = 1e6
const qkey = (v: THREE.Vector3) => `${Math.round(v.x * QUANT)},${Math.round(v.y * QUANT)},${Math.round(v.z * QUANT)}`
const COPLANAR_DOT = 0.9999 // two triangles count as coplanar (same-facing) above this normal dot

// Chamfer prefab geometries (non-indexed, CCW-outward), keyed by shapeKind + mirrored variant.
const CHAMFER_BASE: Record<string, THREE.BufferGeometry> = (() => {
  const ramp = rampGeometry(0)
  const convex = convexCornerGeometry(0)
  const concave = concaveCornerGeometry(0)
  const wedge = wedgeGeometry(0)
  return {
    ramp,
    convex,
    concave,
    wedge,
    rampM: mirrorVGeometry(ramp),
    convexM: mirrorVGeometry(convex),
    concaveM: mirrorVGeometry(concave),
    wedgeM: mirrorVGeometry(wedge),
  }
})()

function faceNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a)).normalize()
}

/** Add one triangle, orienting its winding so its normal agrees with `outward` (if given). */
function addTri(faces: Face[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, mat: Mat, outward?: THREE.Vector3) {
  let n = faceNormal(a, b, c)
  if (n.lengthSq() === 0) return // degenerate
  if (outward && n.dot(outward) < 0) {
    ;[b, c] = [c, b]
    n = n.negate()
  }
  faces.push({ a, b, c, normal: n, colorKey: mat.colorKey, materialClass: mat.materialClass })
}

/** Emit a quad as two triangles split on a canonical diagonal (min→max corner), so coincident
 * faces from adjacent cells produce identical vertex-triples for the shell pass. */
function pushQuad(faces: Face[], corners: THREE.Vector3[], outward: THREE.Vector3, mat: Mat) {
  const s = [...corners].sort((p, q) => qkey(p).localeCompare(qkey(q), undefined, { numeric: true }))
  addTri(faces, s[0], s[1], s[3], mat, outward)
  addTri(faces, s[0], s[3], s[2], mat, outward)
}

function emitCube(faces: Face[], [x, y, z]: Coord, mat: Mat) {
  const x1 = x + 1
  const y1 = y + 1
  const z1 = z + 1
  const P = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz)
  // 6 axis-aligned faces, each with its outward normal.
  pushQuad(faces, [P(x, y, z), P(x, y1, z), P(x, y1, z1), P(x, y, z1)], new THREE.Vector3(-1, 0, 0), mat)
  pushQuad(faces, [P(x1, y, z), P(x1, y1, z), P(x1, y1, z1), P(x1, y, z1)], new THREE.Vector3(1, 0, 0), mat)
  pushQuad(faces, [P(x, y, z), P(x1, y, z), P(x1, y, z1), P(x, y, z1)], new THREE.Vector3(0, -1, 0), mat)
  pushQuad(faces, [P(x, y1, z), P(x1, y1, z), P(x1, y1, z1), P(x, y1, z1)], new THREE.Vector3(0, 1, 0), mat)
  pushQuad(faces, [P(x, y, z), P(x1, y, z), P(x1, y1, z), P(x, y1, z)], new THREE.Vector3(0, 0, -1), mat)
  pushQuad(faces, [P(x, y, z1), P(x1, y, z1), P(x1, y1, z1), P(x, y1, z1)], new THREE.Vector3(0, 0, 1), mat)
}

/** If two triangles share exactly one edge (2 coincident corners) return the 4 distinct corners of
 * the quad they tile, else null. Order is irrelevant — `pushQuad` re-sorts canonically. */
function sharedEdgeQuad(t1: THREE.Vector3[], t2: THREE.Vector3[]): THREE.Vector3[] | null {
  const shared: THREE.Vector3[] = []
  const only1: THREE.Vector3[] = []
  for (const v of t1) {
    if (t2.some((w) => qkey(w) === qkey(v))) shared.push(v)
    else only1.push(v)
  }
  if (shared.length !== 2 || only1.length !== 1) return null
  const only2 = t2.filter((w) => !t1.some((v) => qkey(v) === qkey(w)))
  if (only2.length !== 1) return null
  return [shared[0], shared[1], only1[0], only2[0]]
}

/**
 * Emit a chamfer prefab's transformed triangles, but re-split any coplanar edge-adjacent triangle
 * pair (the flat quad faces — bottom, back walls, single-facet ramp roof) onto `pushQuad`'s canonical
 * diagonal. That makes a chamfer's flat wall an *identical* vertex-triple to a neighbouring cell's
 * coincident face (which is also emitted via `pushQuad`), so the shell pass can cancel the hidden
 * interior faces — fixing the X-pattern stragglers on ramp/concave back walls. Genuinely triangular
 * or folded faces (sloped sides, hip/folded roofs — different normals) emit as-is.
 */
function emitChamfer(faces: Face[], base: THREE.BufferGeometry, matrix: THREE.Matrix4, mat: Mat) {
  const pos = base.getAttribute('position')
  const tris: THREE.Vector3[][] = []
  for (let i = 0; i < pos.count; i += 3) {
    tris.push([
      new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(matrix),
      new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(matrix),
      new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(matrix),
    ])
  }

  const normals = tris.map((t) => faceNormal(t[0], t[1], t[2]))
  const used = new Array(tris.length).fill(false)

  for (let i = 0; i < tris.length; i++) {
    if (used[i]) continue
    let paired = false
    for (let j = i + 1; j < tris.length; j++) {
      if (used[j] || normals[i].dot(normals[j]) < COPLANAR_DOT) continue // must be coplanar (same-facing)
      const quad = sharedEdgeQuad(tris[i], tris[j])
      if (!quad) continue
      pushQuad(faces, quad, normals[i], mat)
      used[i] = used[j] = true
      paired = true
      break
    }
    // Unpaired triangle: prefab is CCW-outward and the matrix is det+1, so winding holds.
    if (!paired) addTri(faces, tris[i][0], tris[i][1], tris[i][2], mat)
  }
}

/**
 * Shell pass: drop back-to-back interior face pairs. Two faces with the same (order-independent)
 * quantized vertex-triple and opposing normals are the touching sides of two adjacent voxels. Culling:
 * - **Same material class:** both faces are dropped — a same-material interface is genuinely hidden.
 * - **Glass against a different material:** only the **glass** face is dropped, keeping the opaque
 *   neighbour's face. This avoids the glass surface z-fighting the coincident solid face behind it,
 *   while the solid face stays visible through the transmission.
 * - **Two different opaque classes** (e.g. matte↔metal): both kept — the interface is inside the solid
 *   model, never seen, so there's nothing to z-fight and different classes live in different meshes.
 * Boundary faces (against empty space) and non-coincident faces are always kept.
 *
 * When `nodeAssignment` is given (animated export), a pair spanning two *different* animation nodes
 * is never cancelled even if otherwise eligible — those cells will move apart independently, so the
 * face between them is a real (if currently coincident) surface, not a hidden interior one.
 */
export function removeInteriorFaces(faces: Face[], nodeAssignment?: Map<CellKey, SliceKey>): Face[] {
  const byTri = new Map<string, number[]>()
  faces.forEach((f, i) => {
    const key = [qkey(f.a), qkey(f.b), qkey(f.c)].sort().join('|')
    const arr = byTri.get(key)
    if (arr) arr.push(i)
    else byTri.set(key, [i])
  })

  const sliceOf = (f: Face) => nodeAssignment?.get(f.cellKey!) ?? ''

  const removed = new Set<number>()
  for (const idxs of byTri.values()) {
    if (idxs.length !== 2) continue
    const [i, j] = idxs
    if (faces[i].normal.dot(faces[j].normal) >= -0.9) continue // not back-to-back
    if (nodeAssignment && sliceOf(faces[i]) !== sliceOf(faces[j])) continue // different animation nodes

    if (faces[i].materialClass === faces[j].materialClass) {
      removed.add(i) // same material → both sides hidden
      removed.add(j)
    } else {
      // Different classes: drop only a glass face (it would z-fight the solid face behind it).
      if (faces[i].materialClass === 'glass') removed.add(i)
      if (faces[j].materialClass === 'glass') removed.add(j)
    }
  }

  return faces.filter((_, i) => !removed.has(i))
}

/**
 * Accumulate every cell's faces and run the shell pass. Shared by the preview and export builders.
 * The shell pass runs across all colors together — interior faces
 * between differently-coloured cells must still cancel — so grouping by colour happens afterward.
 * Returns the surviving faces plus the pre-shell triangle total (for the overlay's raw stat).
 */
function buildShellFaces(
  model: VoxelModel,
  palette: PaletteState,
  nodeAssignment?: Map<CellKey, SliceKey>,
): { faces: Face[]; rawTriangles: number } {
  const faces: Face[] = []
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()

  for (const key of model.color.keys()) {
    const coord = decodeKey(key)
    const slot = model.color.get(key)!.paletteSlot
    const mat: Mat = { colorKey: color.set(resolveSlotColor(palette, slot)).getHex(), materialClass: materialClassFor(slot.kind) }
    const chamfer = model.chamfer.get(key)

    const start = faces.length
    if (chamfer?.resolvedTo) {
      const variant = chamferBasisIsReflected(chamfer.planeAxis, chamfer.planeOrientation) ? 'M' : ''
      const base = CHAMFER_BASE[`${chamfer.resolvedTo.shapeKind}${variant}`]
      chamferInstanceMatrix(coord, chamfer.planeAxis, chamfer.planeOrientation, chamfer.resolvedTo.rotation, matrix)
      emitChamfer(faces, base, matrix, mat)
      for (let i = start; i < faces.length; i++) faces[i].chamfer = chamfer
    } else {
      emitCube(faces, coord, mat)
    }
    for (let i = start; i < faces.length; i++) faces[i].cellKey = key
  }

  const rawTriangles = faces.length
  return { faces: removeInteriorFaces(faces, nodeAssignment), rawTriangles }
}

export interface ColorGroupGeometry {
  /** Packed `0xRRGGBB` (sRGB) — the group's single material colour. */
  colorKey: number
  /** The group's PBR material class (matte/emissive/metal/glass). */
  materialClass: MaterialClass
  geometry: THREE.BufferGeometry
}

/**
 * "Occupied" for the glass occlusion cull (see `meshOptimizer.ts`'s `removeOccludedGlassFaces`):
 * a resolved chamfer cell doesn't fully fill its cube — a wedge or ramp leaves part of the
 * neighbouring face's view open — so it's treated as unoccupied here even though `model.color`
 * has an entry for it. An *unresolved* chamfer cell still renders as a plain cube (see
 * `ChamferCell.resolvedTo`'s doc comment) and counts as occupied like any other solid voxel.
 */
function isCellOccupied(model: VoxelModel, x: number, y: number, z: number): boolean {
  const key = encodeKey(x, y, z)
  if (!model.color.has(key)) return false
  return !model.chamfer.get(key)?.resolvedTo
}

export interface OptimizedVoxelGroups {
  groups: ColorGroupGeometry[]
  rawTriangles: number // total triangles of all per-voxel solid geometries before CSG union
  optimizedTriangles: number // total after CSG per-color-group unions, summed across groups
}

/**
 * Build per-voxel solid geometry grouped by (materialClass, colorKey), then CSG-union each group.
 * CSG boolean union naturally discards interior faces between adjacent same-colour voxels and
 * never creates false edge-bridges between disconnected components. Adjacent voxels of different
 * colours keep their shared interface faces (they live in separate CSG groups).
 *
 * Returns one `ColorGroupGeometry` per (materialClass, colorKey) pair — the consumer creates one
 * solid-colour PBR material per group. No vertex colours are needed.
 */
export function buildOptimizedVoxelGroups(model: VoxelModel, palette: PaletteState, mergeCoplanar?: boolean): OptimizedVoxelGroups {
  const byGroup = new Map<string, VoxelGroup>()
  const color = new THREE.Color()
  const matrix = new THREE.Matrix4()
  let rawTriangles = 0

  for (const key of model.color.keys()) {
    const coord = decodeKey(key)
    const slot = model.color.get(key)!.paletteSlot
    const materialClass = materialClassFor(slot.kind)
    const colorKey = color.set(resolveSlotColor(palette, slot)).getHex()
    const chamfer = model.chamfer.get(key)

    const groupKey = `${materialClass}:${colorKey}`
    let group = byGroup.get(groupKey)
    if (!group) {
      group = { colorKey, materialClass, geometries: [] }
      byGroup.set(groupKey, group)
    }

    let geom: THREE.BufferGeometry
    if (chamfer?.resolvedTo) {
      const variant = chamferBasisIsReflected(chamfer.planeAxis, chamfer.planeOrientation) ? 'M' : ''
      const base = CHAMFER_BASE[`${chamfer.resolvedTo.shapeKind}${variant}`]
      geom = base.clone()
      chamferInstanceMatrix(coord, chamfer.planeAxis, chamfer.planeOrientation, chamfer.resolvedTo.rotation, matrix)
      geom.applyMatrix4(matrix)
    } else {
      geom = new THREE.BoxGeometry(1, 1, 1)
      geom.translate(coord[0] + 0.5, coord[1] + 0.5, coord[2] + 0.5)
    }

    rawTriangles += triangleCount(geom)
    group.geometries.push(geom)
  }

  const isOccupied = (x: number, y: number, z: number) => isCellOccupied(model, x, y, z)
  const groups = optimizeGroupsByCSG(Array.from(byGroup.values()), mergeCoplanar ?? true, isOccupied)
  let optimizedTriangles = 0
  for (const g of groups) optimizedTriangles += triangleCount(g.geometry)

  return { groups, rawTriangles, optimizedTriangles }
}

/** Per-(materialClass, colorKey) optimized geometries for GLTF export — one solid-colour mesh per group. */
export function buildOptimizedVoxelGeometryByMaterial(model: VoxelModel, palette: PaletteState, mergeCoplanar?: boolean): ColorGroupGeometry[] {
  return buildOptimizedVoxelGroups(model, palette, mergeCoplanar).groups
}

export interface SliceGroupGeometry extends ColorGroupGeometry {
  sliceKey: SliceKey
}

export interface SliceGroupResult {
  groups: SliceGroupGeometry[]
  rawTriangles: number
  optimizedTriangles: number
}

/**
 * Build per-voxel solid geometry grouped by (materialClass, colorKey, sliceKey), then CSG-union
 * each group. This splits voxels into separate meshes per animation node so each animated slice
 * gets its own GLTF node. Voxels assigned to the remainder (sliceKey = "") live in the root group.
 *
 * `nodeAssignment` maps each CellKey to the SliceKey of the animation node that owns it.
 * Voxels not in the map are treated as remainder.
 */
export function buildOptimizedVoxelGroupsBySlice(
  model: VoxelModel,
  palette: PaletteState,
  nodeAssignment: Map<CellKey, SliceKey>,
  mergeCoplanar?: boolean,
): SliceGroupResult {
  const byGroup = new Map<string, VoxelGroup & { sliceKey: SliceKey }>()
  const color = new THREE.Color()
  const matrix = new THREE.Matrix4()
  let rawTriangles = 0

  for (const key of model.color.keys()) {
    const coord = decodeKey(key)
    const slot = model.color.get(key)!.paletteSlot
    const materialClass = materialClassFor(slot.kind)
    const colorKey = color.set(resolveSlotColor(palette, slot)).getHex()
    const chamfer = model.chamfer.get(key)

    const sliceKey = nodeAssignment.get(key) ?? ''

    const groupKey = `${materialClass}:${colorKey}:${sliceKey}`
    let group = byGroup.get(groupKey)
    if (!group) {
      group = { colorKey, materialClass, geometries: [], sliceKey }
      byGroup.set(groupKey, group)
    }

    let geom: THREE.BufferGeometry
    if (chamfer?.resolvedTo) {
      const variant = chamferBasisIsReflected(chamfer.planeAxis, chamfer.planeOrientation) ? 'M' : ''
      const base = CHAMFER_BASE[`${chamfer.resolvedTo.shapeKind}${variant}`]
      geom = base.clone()
      chamferInstanceMatrix(coord, chamfer.planeAxis, chamfer.planeOrientation, chamfer.resolvedTo.rotation, matrix)
      geom.applyMatrix4(matrix)
    } else {
      geom = new THREE.BoxGeometry(1, 1, 1)
      geom.translate(coord[0] + 0.5, coord[1] + 0.5, coord[2] + 0.5)
    }

    rawTriangles += triangleCount(geom)
    group.geometries.push(geom)
  }

  const isOccupied = (x: number, y: number, z: number) => isCellOccupied(model, x, y, z)
  const groups: SliceGroupGeometry[] = optimizeGroupsByCSG(Array.from(byGroup.values()), mergeCoplanar ?? true, isOccupied)
  let optimizedTriangles = 0
  for (const g of groups) optimizedTriangles += triangleCount(g.geometry)

  return { groups, rawTriangles, optimizedTriangles }
}

/**
 * Like `geometryFromFaces` but for the box-map texture path: carries per-vertex `color` (RGB, for the
 * shade/multiply material) **and** a `uv` attribute from the injected generator. The coplanar-merge
 * optimizer is deliberately **not** run on textured geometry — box-map UVs are a pure function of
 * (world position, projection face), so leaving the shell faces un-welded keeps UV assignment trivial
 * and correct without teaching the optimizer to carry UVs.
 */
function geometryFromFacesUV(faces: Face[], uvFor: VertexUV): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const color = new THREE.Color()
  for (const f of faces) {
    color.setHex(f.colorKey)
    for (const v of [f.a, f.b, f.c]) {
      positions.push(v.x, v.y, v.z)
      normals.push(f.normal.x, f.normal.y, f.normal.z)
      colors.push(color.r, color.g, color.b)
      const [uu, vv] = uvFor(f.chamfer, f.normal, v)
      uvs.push(uu, vv)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

/** Build the shell-culled mesh with per-vertex box-map UVs + color for the Texture-mode preview
 * (single geometry, one atlas material). See `geometryFromFacesUV` on why the coplanar merge is skipped. */
export function buildTexturedShellGeometry(model: VoxelModel, palette: PaletteState, uvFor: VertexUV): THREE.BufferGeometry {
  const { faces } = buildShellFaces(model, palette)
  return geometryFromFacesUV(faces, uvFor)
}

/** Per-(color, material class) split of the textured shell, for GLTF export — each group carries UVs
 * so every per-color material can share the atlas map (baseColor × map = the shade/multiply preview). */
export function buildTexturedShellGeometryByColor(model: VoxelModel, palette: PaletteState, uvFor: VertexUV): ColorGroupGeometry[] {
  const { faces } = buildShellFaces(model, palette)
  const byMaterial = new Map<string, Face[]>()
  for (const f of faces) {
    const matKey = `${f.colorKey}:${f.materialClass}`
    const group = byMaterial.get(matKey)
    if (group) group.push(f)
    else byMaterial.set(matKey, [f])
  }
  const out: ColorGroupGeometry[] = []
  for (const group of byMaterial.values()) {
    out.push({ colorKey: group[0].colorKey, materialClass: group[0].materialClass, geometry: geometryFromFacesUV(group, uvFor) })
  }
  return out
}

/** Per-(color, material class, animation slice) split of the textured shell, for animated GLTF
 * export. Faces spanning two different animation nodes are never shell-culled (see
 * `removeInteriorFaces`), so each node's mesh stays watertight once it moves independently. */
export function buildTexturedShellGeometryBySliceColor(
  model: VoxelModel,
  palette: PaletteState,
  uvFor: VertexUV,
  nodeAssignment: Map<CellKey, SliceKey>,
): SliceGroupGeometry[] {
  const { faces } = buildShellFaces(model, palette, nodeAssignment)
  const byGroup = new Map<string, Face[]>()
  for (const f of faces) {
    const sliceKey = nodeAssignment.get(f.cellKey!) ?? ''
    const groupKey = `${f.colorKey}:${f.materialClass}:${sliceKey}`
    const group = byGroup.get(groupKey)
    if (group) group.push(f)
    else byGroup.set(groupKey, [f])
  }
  const out: SliceGroupGeometry[] = []
  for (const group of byGroup.values()) {
    const sliceKey = nodeAssignment.get(group[0].cellKey!) ?? ''
    out.push({ colorKey: group[0].colorKey, materialClass: group[0].materialClass, sliceKey, geometry: geometryFromFacesUV(group, uvFor) })
  }
  return out
}
