import * as THREE from 'three'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import type { CellKey, ChamferCell, Coord, VoxelModel } from '@/engine/grid/types'
import { concaveCornerGeometry, convexCornerGeometry, flatGeometry, flatWedgeGeometry, halfGeometry, mirrorVGeometry, postGeometry, quarterGeometry, rampGeometry, thinGeometry, wedgeGeometry } from '@/engine/chamfer/chamferGeometry'
import { materialClassFor, resolveSlotColor, type MaterialClass } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import type { SliceKey } from '@/engine/animation/types'
import { chamferBasisIsReflected, chamferInstanceMatrix } from './basis'
import { mergeCoplanarFacesWithKeys, optimizeGroupsByCSG, triangleCount, type VoxelGroup } from './meshOptimizer'

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
  /**
   * One winding of a two-sided flat (`flat`/`flatwedge`): export emits both windings as
   * coincident opposite-normal quads so the GLB reads from both sides without relying on
   * double-sided materials. Tagged faces are never paired by the shell pass (`removeInteriorFaces`)
   * — the pair is the surface, not a hidden interior interface.
   */
  twoSided?: boolean
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
  const thin = thinGeometry()
  const half = halfGeometry()
  const post = postGeometry()
  const quarter = quarterGeometry(0)
  const flat = flatGeometry()
  const flatwedge = flatWedgeGeometry(0)
  return {
    ramp,
    convex,
    concave,
    wedge,
    thin,
    half,
    post,
    quarter,
    flat,
    flatwedge,
    rampM: mirrorVGeometry(ramp),
    convexM: mirrorVGeometry(convex),
    concaveM: mirrorVGeometry(concave),
    wedgeM: mirrorVGeometry(wedge),
    thinM: mirrorVGeometry(thin),
    halfM: mirrorVGeometry(half),
    postM: mirrorVGeometry(post),
    quarterM: mirrorVGeometry(quarter),
    flatM: mirrorVGeometry(flat),
    flatwedgeM: mirrorVGeometry(flatwedge),
  }
})()

function faceNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a)).normalize()
}

/** Clone a non-indexed geometry with every triangle's winding reversed and normals negated —
 * the back winding of a two-sided flat export pair. Flat prefabs carry position+normal only.
 * Normals are negated on ALL three vertices (not just the swapped pair): the merge reads the
 * first vertex's normal, so a stale +z there would group the back winding with the front. */
function reverseWinding(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = geom.clone()
  const pos = out.getAttribute('position') as THREE.BufferAttribute
  const nrm = out.getAttribute('normal') as THREE.BufferAttribute
  const parr = pos.array as Float32Array
  const narr = nrm.array as Float32Array
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = (i + 1) * 3 + k
      const c = (i + 2) * 3 + k
      const tp = parr[a]
      parr[a] = parr[c]
      parr[c] = tp
      const tn = -narr[a]
      narr[a] = -narr[c]
      narr[c] = tn
      narr[i * 3 + k] = -narr[i * 3 + k]
    }
  }
  pos.needsUpdate = true
  nrm.needsUpdate = true
  return out
}

/**
 * Push one cell's CSG-path geometry, plus the reversed winding for two-sided flats. An open
 * quad is undefined behaviour for the ThreeBSP union, so both flat windings bypass it: marked
 * `userData.twoSidedFlat` for `optimizeGroupsByCSG` to append post-union (the same pair the
 * shell path emits as tagged `Face`s). Returns the appended triangle count for `rawTriangles`.
 */
function pushCellGeometry(group: VoxelGroup, geom: THREE.BufferGeometry, chamfer: ChamferCell | undefined): number {
  group.geometries.push(geom)
  const kind = chamfer?.resolvedTo?.shapeKind
  if (kind !== 'flat' && kind !== 'flatwedge') return 0
  geom.userData.twoSidedFlat = true
  const back = reverseWinding(geom)
  back.userData.twoSidedFlat = true
  group.geometries.push(back)
  return triangleCount(back)
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
 * - **Both sides opaque** (matte/emissive/metal, same or different class): both faces are dropped —
 *   the interface sits inside the combined solid and is never seen. Each material's mesh keeps a
 *   hidden hole at the interface; the holes coincide, so nothing shows from outside. (Keeping both
 *   sides instead leaves coincident opposite-normal quads that z-fight in some engines — e.g. an
 *   emissive lamp block directly under a matte cap.)
 * - **Glass against a different material:** only the **glass** face is dropped, keeping the opaque
 *   neighbour's face. This avoids the glass surface z-fighting the coincident solid face behind it,
 *   while the solid face stays visible through the transmission.
 * - **Glass against glass:** both dropped (same-class rule).
 * Boundary faces (against empty space) and non-coincident faces are always kept.
 *
 * When `nodeAssignment` is given (animated export), a pair spanning two *different* animation nodes
 * is never cancelled even if otherwise eligible — those cells will move apart independently, so the
 * face between them is a real (if currently coincident) surface, not a hidden interior one.
 * `rigAssignment` extends the same rule to rig boxes: pairs spanning different rigs are never
 * cancelled, so touching joints stay separable downstream.
 *
 * With `cullCrossGroup: false` only **same-group** pairs (identical materialClass *and* colorKey,
 * i.e. one export mesh) are culled — the union-equivalent for the shell path. Interfaces between
 * different colors/materials keep both sides so touching parts stay separable downstream. The
 * glass-vs-solid rule is unchanged (the glass side is still dropped to avoid z-fighting); the
 * solid side's kept face still marks the seam.
 */
export function removeInteriorFaces(faces: Face[], nodeAssignment?: Map<CellKey, SliceKey>, cullCrossGroup = true, rigAssignment?: Map<CellKey, string>): Face[] {
  const byTri = new Map<string, number[]>()
  faces.forEach((f, i) => {
    const key = [qkey(f.a), qkey(f.b), qkey(f.c)].sort().join('|')
    const arr = byTri.get(key)
    if (arr) arr.push(i)
    else byTri.set(key, [i])
  })

  const sliceOf = (f: Face) => nodeAssignment?.get(f.cellKey!) ?? ''
  const rigOf = (f: Face) => rigAssignment?.get(f.cellKey!) ?? ''

  const removed = new Set<number>()
  for (const idxs of byTri.values()) {
    if (idxs.length !== 2) continue
    const [i, j] = idxs
    // A two-sided flat's own windings share a vertex-triple by construction — they are the
    // visible surface from opposite sides, never a hidden interior interface. Never pair them.
    if (faces[i].twoSided || faces[j].twoSided) continue
    if (faces[i].normal.dot(faces[j].normal) >= -0.9) continue // not back-to-back
    // Faces spanning different animation nodes — or different rig boxes — will move apart
    // independently, so their interface is real, not hidden. Never cancel it.
    if (nodeAssignment && sliceOf(faces[i]) !== sliceOf(faces[j])) continue
    if (rigAssignment && rigOf(faces[i]) !== rigOf(faces[j])) continue

    const sameGroup =
      faces[i].materialClass === faces[j].materialClass && faces[i].colorKey === faces[j].colorKey
    if (!sameGroup && !cullCrossGroup) {
      // No-cull export mode: only same-export-mesh pairs cancel. Cross-group interfaces keep
      // both sides — except glass-involved pairs, which keep the existing glass-side-only
      // drop so the kept glass face can't z-fight the coincident solid face.
      if (faces[i].materialClass === 'glass' || faces[j].materialClass === 'glass') {
        if (faces[i].materialClass === 'glass') removed.add(i)
        if (faces[j].materialClass === 'glass') removed.add(j)
      }
      continue
    }

    if (faces[i].materialClass === faces[j].materialClass) {
      removed.add(i) // same material → both sides hidden
      removed.add(j)
    } else if (faces[i].materialClass !== 'glass' && faces[j].materialClass !== 'glass') {
      removed.add(i) // different opaque classes (e.g. matte↔emissive) → both sides hidden
      removed.add(j)
    } else {
      // Glass against a different class: drop only the glass face (it would z-fight the solid
      // face behind it, while the solid face stays visible through the transmission).
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
 *
 * With `cullInteriorFaces: false` only same-export-mesh pairs cancel (the union-equivalent);
 * interfaces between different colors/materials keep both sides so touching parts stay
 * separable downstream. The coplanar merge is unaffected (per-group, so it can never weld
 * across a kept seam).
 */
function buildShellFaces(
  model: VoxelModel,
  palette: PaletteState,
  nodeAssignment?: Map<CellKey, SliceKey>,
  cullInteriorFaces = true,
  rigAssignment?: Map<CellKey, string>,
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
      const kind = chamfer.resolvedTo.shapeKind
      if (kind === 'flat' || kind === 'flatwedge') {
        // Two-sided export: the editor renders the single quad DoubleSide, but export must read
        // from both sides without relying on double-sided materials — append the reversed
        // winding as coincident opposite-normal quads. Both windings are tagged so the shell
        // pass below never pairs them back together (see `Face.twoSided`).
        const end = faces.length
        for (let i = start; i < end; i++) {
          const f = faces[i]
          f.twoSided = true
          faces.push({
            a: f.a,
            b: f.c,
            c: f.b,
            normal: f.normal.clone().negate(),
            colorKey: f.colorKey,
            materialClass: f.materialClass,
            twoSided: true,
          })
        }
      }
      for (let i = start; i < faces.length; i++) faces[i].chamfer = chamfer
    } else {
      emitCube(faces, coord, mat)
    }
    for (let i = start; i < faces.length; i++) faces[i].cellKey = key
  }

  const rawTriangles = faces.length
  return { faces: removeInteriorFaces(faces, nodeAssignment, cullInteriorFaces, rigAssignment), rawTriangles }
}

export interface ColorGroupGeometry {
  /** Packed `0xRRGGBB` (sRGB) — the group's single material colour. */
  colorKey: number
  /** The group's PBR material class (matte/emissive/metal/glass). */
  materialClass: MaterialClass
  geometry: THREE.BufferGeometry
  /** Rig box id owning this group, when the voxel lies inside a named rig box. */
  rigId?: string
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
 * CSG boolean union naturally discards interior faces between adjacent same-group voxels and
 * never creates false edge-bridges between disconnected components. Exactly-coincident
 * back-to-back interface faces between adjacent *opaque* groups are then culled on both sides
 * (see `cullCoincidentOpaqueInterfaces` in `meshOptimizer.ts`) — the interface is inside the
 * combined solid. Glass-involved interfaces keep the solid side (glass side only is dropped).
 *
 * With `cullInteriorFaces: false` the cross-group cull is skipped while the union and the
 * coplanar merge still run: same-color neighbors weld exactly as before, but interfaces
 * between different colors/materials keep both sides so touching parts stay separable
 * downstream.
 *
 * Returns one `ColorGroupGeometry` per (materialClass, colorKey) pair — the consumer creates one
 * solid-colour PBR material per group. No vertex colours are needed.
 */
export function buildOptimizedVoxelGroups(model: VoxelModel, palette: PaletteState, mergeCoplanar?: boolean, cullInteriorFaces = true, rigAssignment?: Map<CellKey, string>): OptimizedVoxelGroups {
  const byGroup = new Map<string, VoxelGroup & { rigId?: string }>()
  const color = new THREE.Color()
  const matrix = new THREE.Matrix4()
  let rawTriangles = 0

  for (const key of model.color.keys()) {
    const coord = decodeKey(key)
    const slot = model.color.get(key)!.paletteSlot
    const materialClass = materialClassFor(slot.kind)
    const colorKey = color.set(resolveSlotColor(palette, slot)).getHex()
    const chamfer = model.chamfer.get(key)

    const rigId = rigAssignment?.get(key)
    const groupKey = `${materialClass}:${colorKey}:${rigId ?? ''}`
    let group = byGroup.get(groupKey)
    if (!group) {
      group = { colorKey, materialClass, geometries: [], rigId }
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

    rawTriangles += triangleCount(geom) + pushCellGeometry(group, geom, chamfer)
  }

  const isOccupied = (x: number, y: number, z: number) => isCellOccupied(model, x, y, z)
  const groups = optimizeGroupsByCSG(Array.from(byGroup.values()), mergeCoplanar ?? true, isOccupied, cullInteriorFaces)
  let optimizedTriangles = 0
  for (const g of groups) optimizedTriangles += triangleCount(g.geometry)

  return { groups, rawTriangles, optimizedTriangles }
}

/** Per-(materialClass, colorKey) optimized geometries for GLTF export — one solid-colour mesh per group. */
export function buildOptimizedVoxelGeometryByMaterial(model: VoxelModel, palette: PaletteState, mergeCoplanar?: boolean, cullInteriorFaces = true, rigAssignment?: Map<CellKey, string>): ColorGroupGeometry[] {
  return buildOptimizedVoxelGroups(model, palette, mergeCoplanar, cullInteriorFaces, rigAssignment).groups
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
  cullInteriorFaces = true,
  rigAssignment?: Map<CellKey, string>,
): SliceGroupResult {
  const byGroup = new Map<string, VoxelGroup & { sliceKey: SliceKey; rigId?: string }>()
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
    const rigId = rigAssignment?.get(key)

    const groupKey = `${materialClass}:${colorKey}:${sliceKey}:${rigId ?? ''}`
    let group = byGroup.get(groupKey)
    if (!group) {
      group = { colorKey, materialClass, geometries: [], sliceKey, rigId }
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

    rawTriangles += triangleCount(geom) + pushCellGeometry(group, geom, chamfer)
  }

  const isOccupied = (x: number, y: number, z: number) => isCellOccupied(model, x, y, z)
  const groups: SliceGroupGeometry[] = optimizeGroupsByCSG(Array.from(byGroup.values()), mergeCoplanar ?? true, isOccupied, cullInteriorFaces)
  let optimizedTriangles = 0
  for (const g of groups) optimizedTriangles += triangleCount(g.geometry)

  return { groups, rawTriangles, optimizedTriangles }
}

function geometryFromFaces(faces: Face[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  for (const f of faces) {
    for (const v of [f.a, f.b, f.c]) {
      positions.push(v.x, v.y, v.z)
      normals.push(f.normal.x, f.normal.y, f.normal.z)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geometry
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

export function buildShellGeometryByFacePredicate(
  model: VoxelModel,
  palette: PaletteState,
  predicate: (chamfer: ChamferCell | undefined, normal: THREE.Vector3) => boolean,
): THREE.BufferGeometry {
  const { faces } = buildShellFaces(model, palette)
  return geometryFromFaces(faces.filter((f) => predicate(f.chamfer, f.normal)))
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
 * `removeInteriorFaces`), so each node's mesh stays watertight once it moves independently.
 * With `cullInteriorFaces: false` no interface is culled at all. */
export function buildTexturedShellGeometryBySliceColor(  model: VoxelModel,
  palette: PaletteState,
  uvFor: VertexUV,
  nodeAssignment: Map<CellKey, SliceKey>,
  cullInteriorFaces = true,
  rigAssignment?: Map<CellKey, string>,
): SliceGroupGeometry[] {
  const { faces } = buildShellFaces(model, palette, nodeAssignment, cullInteriorFaces, rigAssignment)
  const byGroup = new Map<string, Face[]>()
  for (const f of faces) {
    const sliceKey = nodeAssignment.get(f.cellKey!) ?? ''
    const rigId = f.cellKey ? rigAssignment?.get(f.cellKey) : undefined
    const groupKey = `${f.colorKey}:${f.materialClass}:${sliceKey}:${rigId ?? ''}`
    const group = byGroup.get(groupKey)
    if (group) group.push(f)
    else byGroup.set(groupKey, [f])
  }
  const out: SliceGroupGeometry[] = []
  for (const group of byGroup.values()) {
    const sliceKey = nodeAssignment.get(group[0].cellKey!) ?? ''
    const rigId = group[0].cellKey ? rigAssignment?.get(group[0].cellKey!) : undefined
    out.push({ colorKey: group[0].colorKey, materialClass: group[0].materialClass, sliceKey, rigId, geometry: geometryFromFacesUV(group, uvFor) })
  }
  return out
}

/**
 * Box-face tag a shell face samples its texture from, injected so `engine/instancing` keeps no
 * dependency on `engine/texture` (same pattern as `VertexUV`). The texture layer resolves it via
 * `boxFaceForCell` — the exact page the unmerged path would sample for this face.
 */
export type TexturedFaceTag = string
export type TagForTexturedFace = (chamfer: ChamferCell | undefined, normal: THREE.Vector3) => TexturedFaceTag
/** UV lookup for a merged vertex: the box-map projection of `vertex` onto the tagged page. */
export type UVForTexturedTag = (tag: TexturedFaceTag, vertex: THREE.Vector3) => [number, number]

export interface TexturedGroupsResult {
  groups: ColorGroupGeometry[]
  /** Shell triangles after interior-face culling, before any coplanar merge. */
  rawTriangles: number
  /** Triangles after the (optional) coplanar merge. */
  optimizedTriangles: number
}

/**
 * Per-(color, material class) textured shell with an optional tag-aware coplanar merge — the
 * Model-mode preview path for textured models. Merge groups are keyed on (material, color,
 * texture page), so a weld never mixes materials, colors, or texture pages; UVs are recomputed
 * per merged vertex from (page, position), which is exact because the box-map projection is
 * affine in position for a fixed page (the rasterizer's barycentric interpolation then
 * reproduces the per-texel mapping precisely, including across freshly triangulated interiors).
 *
 * With `mergeCoplanar` off this reduces to the plain shell (same output as
 * `buildTexturedShellGeometryByColor`, plus counts) — the toggle-off path stays untouched.
 * With `cullInteriorFaces: false` cross-group shell interfaces are kept, but the merge still
 * runs: it is keyed per (material, color, texture page), so it can never weld across a kept
 * seam.
 */
export function buildTexturedShellGeometryByColorMerged(
  model: VoxelModel,
  palette: PaletteState,
  tagFor: TagForTexturedFace,
  uvForTag: UVForTexturedTag,
  mergeCoplanar: boolean,
  cullInteriorFaces = true,
  rigAssignment?: Map<CellKey, string>,
): TexturedGroupsResult {
  const { faces } = buildShellFaces(model, palette, undefined, cullInteriorFaces, rigAssignment)
  const byMaterial = new Map<string, Face[]>()
  for (const f of faces) {
    const rigId = f.cellKey ? rigAssignment?.get(f.cellKey) : undefined
    const matKey = `${f.colorKey}:${f.materialClass}:${rigId ?? ''}`
    const group = byMaterial.get(matKey)
    if (group) group.push(f)
    else byMaterial.set(matKey, [f])
  }

  const out: ColorGroupGeometry[] = []
  let optimizedTriangles = 0
  const color = new THREE.Color()
  for (const group of byMaterial.values()) {
    const [{ colorKey, materialClass }] = group
    const rigId = group[0].cellKey ? rigAssignment?.get(group[0].cellKey!) : undefined
    color.setHex(colorKey)
    if (!mergeCoplanar) {
      const positions: number[] = []
      const normals: number[] = []
      const colors: number[] = []
      const uvs: number[] = []
      for (const f of group) {
        const tag = tagFor(f.chamfer, f.normal)
        for (const v of [f.a, f.b, f.c]) {
          positions.push(v.x, v.y, v.z)
          normals.push(f.normal.x, f.normal.y, f.normal.z)
          colors.push(color.r, color.g, color.b)
          const [uu, vv] = uvForTag(tag, v)
          uvs.push(uu, vv)
        }
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      optimizedTriangles += triangleCount(geometry)
      out.push({ colorKey, materialClass, rigId, geometry })
      continue
    }

    // Merge input soup (position + flat normal per shell triangle) with the texture page as the
    // per-triangle merge key; the merged output reports one page per surviving triangle.
    // Two-sided flats merge in their OWN pass (flats only with flats — never with solids): the
    // flat subset welds coplanar same-facing quads across cells into panes, while the same-facing
    // rule keeps each flat's opposite-winding pair intact, exactly like the CSG path's flat pass.
    const mergeFaces = (subset: Face[]) => {
      const inPositions: number[] = []
      const inNormals: number[] = []
      const inTags: string[] = []
      for (const f of subset) {
        const tag = tagFor(f.chamfer, f.normal)
        for (const v of [f.a, f.b, f.c]) {
          inPositions.push(v.x, v.y, v.z)
          inNormals.push(f.normal.x, f.normal.y, f.normal.z)
        }
        inTags.push(tag)
      }
      const soup = new THREE.BufferGeometry()
      soup.setAttribute('position', new THREE.Float32BufferAttribute(inPositions, 3))
      soup.setAttribute('normal', new THREE.Float32BufferAttribute(inNormals, 3))
      const merged = mergeCoplanarFacesWithKeys(soup, (t) => inTags[t])
      soup.dispose()
      return merged
    }
    const emitMerged = (merged: { geometry: THREE.BufferGeometry; keys: TexturedFaceTag[] }) => {
      const mergedPos = merged.geometry.getAttribute('position') as THREE.BufferAttribute
      const mergedNrm = merged.geometry.getAttribute('normal') as THREE.BufferAttribute
      const positions: number[] = []
      const normals: number[] = []
      const colors: number[] = []
      const uvs: number[] = []
      const v = new THREE.Vector3()
      for (let t = 0; t < merged.keys.length; t++) {
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(mergedPos, t * 3 + k)
          positions.push(v.x, v.y, v.z)
          normals.push(mergedNrm.getX(t * 3 + k), mergedNrm.getY(t * 3 + k), mergedNrm.getZ(t * 3 + k))
          colors.push(color.r, color.g, color.b)
          const [uu, vv] = uvForTag(merged.keys[t], v)
          uvs.push(uu, vv)
        }
      }
      merged.geometry.dispose()
      return { positions, normals, colors, uvs }
    }
    const solidFaces = group.filter((f) => !f.twoSided)
    const flatFaces = group.filter((f) => f.twoSided)
    const positions: number[] = []
    const normals: number[] = []
    const colors: number[] = []
    const uvs: number[] = []
    for (const subset of [solidFaces, flatFaces]) {
      if (subset.length === 0) continue
      const out = emitMerged(mergeFaces(subset))
      positions.push(...out.positions)
      normals.push(...out.normals)
      colors.push(...out.colors)
      uvs.push(...out.uvs)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    optimizedTriangles += triangleCount(geometry)
    out.push({ colorKey, materialClass, rigId, geometry })
  }

  return { groups: out, rawTriangles: faces.length, optimizedTriangles }
}
