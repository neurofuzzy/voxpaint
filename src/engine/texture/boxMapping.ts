import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex, ALL_AXES } from '@/engine/plane/planeGeometry'
import type { Axis, ChamferCell, Coord } from '@/engine/grid/types'
import type { BoxFace, TextureModel } from './types'
import { BOX_FACE_AXIS, boxFaceOf, EMPTY, FACE_SIZE, GRAYSCALE, HALF_WORLD, TEXEL_SCALE } from './types'

/** Grayscale index → overlay blend value in [0,1], evenly spaced (`index/7`): indices 0–3 fall below
 * 0.5 (darken), 4–7 above (lighten), and none is exactly 0.5. Unpainted (`EMPTY`) is neutral 0.5. */
function blendForIndex(index: number): number {
  if (index === EMPTY) return 0.5
  return index / (GRAYSCALE.length - 1)
}

// --- Atlas layout: the 6 faces packed into a 3×2 grid -----------------------------------------
const ATLAS_COLS = 3
const ATLAS_ROWS = 2
export const ATLAS_WIDTH = ATLAS_COLS * FACE_SIZE
export const ATLAS_HEIGHT = ATLAS_ROWS * FACE_SIZE

export const FACE_ATLAS_CELL: Record<BoxFace, { col: number; row: number }> = {
  px: { col: 0, row: 0 },
  py: { col: 1, row: 0 },
  pz: { col: 2, row: 0 },
  nx: { col: 0, row: 1 },
  ny: { col: 1, row: 1 },
  nz: { col: 2, row: 1 },
}

/**
 * Which box face a model face is textured from. A chamfer's mapping direction is ambiguous (its
 * sloped faces have diagonal normals), so **every face of a chamfer cell uses the axis the chamfer
 * was authored in** (`planeAxis`/`planeOrientation`). Plain cube faces use their own axis-aligned
 * normal's dominant axis + sign.
 */
export function boxFaceForCell(chamfer: ChamferCell | undefined, normal: Coord): BoxFace {
  if (chamfer) return boxFaceOf(chamfer.planeAxis, chamfer.planeOrientation)
  let axis: Axis = 'x'
  let maxAbs = -Infinity
  for (const a of ALL_AXES) {
    const abs = Math.abs(normal[axisIndex(a)])
    if (abs > maxAbs) {
      maxAbs = abs
      axis = a
    }
  }
  return boxFaceOf(axis, normal[axisIndex(axis)] >= 0 ? 1 : -1)
}

// Cache per-axis logical basis (three axes, derived once) so the hot UV path stays allocation-free.
const AXIS_BASIS: Record<Axis, { uDir: Coord; vDir: Coord }> = {
  x: planeLogicalBasis('x'),
  y: planeLogicalBasis('y'),
  z: planeLogicalBasis('z'),
}

const dot = (a: Coord, b: Coord) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Per-face in-plane flips applied on top of the shared axis basis. `planeLogicalBasis` gives one
 * consistent basis per axis, but the two faces of an axis view their shared plane from opposite
 * sides, so exactly one of each pair must mirror an in-plane axis to read correctly from outside
 * (the standard box-map "wrap around"). With the basis's default (u = right, v = down-on-canvas),
 * the faces needing a flip are: `nx` (U ← +z), `nz` (U ← -x), `py` (V ← +z). Their partners
 * (`px`, `pz`, `ny`) — and every cube's normal-derived face — keep the basis unflipped.
 */
const FLIP_U: Record<BoxFace, boolean> = { px: false, nx: true, py: false, ny: false, pz: false, nz: true }
const FLIP_V: Record<BoxFace, boolean> = { px: false, nx: false, py: true, ny: false, pz: false, nz: false }

/**
 * Projects a world vertex onto a box face's two in-plane axes, returning **continuous** texel
 * coordinates in `[0, FACE_SIZE]`. Reuses `planeLogicalBasis` so the projection matches the 2D
 * canvas's u/v convention, plus the per-face `FLIP_U`/`FLIP_V` correction so each face reads the
 * same way it was painted when viewed from outside the model.
 */
export function worldToTexel(face: BoxFace, x: number, y: number, z: number): [number, number] {
  const { axis } = BOX_FACE_AXIS[face]
  const { uDir, vDir } = AXIS_BASIS[axis]
  const p: Coord = [x, y, z]
  const pu = FLIP_U[face] ? -dot(p, uDir) : dot(p, uDir)
  const pv = FLIP_V[face] ? -dot(p, vDir) : dot(p, vDir)
  return [(pu + HALF_WORLD) * TEXEL_SCALE, (pv + HALF_WORLD) * TEXEL_SCALE]
}

/**
 * Maps a face's (continuous) texel coordinate to a normalized atlas UV. Paired with `buildAtlas`'s
 * identical placement, so a vertex projected via `worldToTexel` samples the exact texel painted at
 * (tu, tv) on that face.
 */
export function atlasUVFor(face: BoxFace, tu: number, tv: number): [number, number] {
  const { col, row } = FACE_ATLAS_CELL[face]
  const atlasX = col * FACE_SIZE + tu
  const atlasY = row * FACE_SIZE + tv
  return [atlasX / ATLAS_WIDTH, atlasY / ATLAS_HEIGHT]
}

/**
 * Atlas UV for a mesh vertex, derived purely from its world position and outward normal (the normal
 * picks the box face). Because `worldToTexel` and `atlasUVFor` are both affine in-plane, evaluating
 * this per vertex and letting the rasterizer interpolate reproduces the exact per-texel mapping even
 * across the large coplanar quads the mesh optimizer welds together.
 */
export function atlasUVForVertex(normal: Coord, x: number, y: number, z: number): [number, number] {
  const face = boxFaceForCell(undefined, normal)
  const [tu, tv] = worldToTexel(face, x, y, z)
  return atlasUVFor(face, tu, tv)
}

/**
 * Inverse of `worldToTexel` for a texel **centre**: given a box face, integer texel (tu, tv), and the
 * surface's coordinate along the face axis (`depthCoord`), returns the world-space point on that face.
 * Reuses the same axis basis + per-face flips as `worldToTexel`, so the round-trip is exact — used by
 * the AO bake to place a sample point at each atlas texel.
 */
export function texelCenterToWorld(face: BoxFace, tu: number, tv: number, depthCoord: number): Coord {
  const { axis } = BOX_FACE_AXIS[face]
  const { uDir, vDir } = AXIS_BASIS[axis]
  const su = (tu + 0.5) / TEXEL_SCALE - HALF_WORLD
  const sv = (tv + 0.5) / TEXEL_SCALE - HALF_WORLD
  const du = FLIP_U[face] ? -su : su // = dot(worldPos, uDir)
  const dv = FLIP_V[face] ? -sv : sv // = dot(worldPos, vDir)
  const p: Coord = [0, 0, 0]
  // uDir/vDir are axis-aligned unit vectors: p[k] = d · dir[k] recovers the component (dir[k]² = 1).
  for (let k = 0; k < 3; k++) {
    if (uDir[k] !== 0) p[k] = du * uDir[k]
    if (vDir[k] !== 0) p[k] = dv * vDir[k]
  }
  p[axisIndex(axis)] = depthCoord
  return p
}

/**
 * Rasterizes the 6 texture faces into a single RGBA **blend atlas** (3×2 packing): each pixel's
 * R=G=B is the overlay blend value (`index/4`, unpainted = neutral 0.5), scaled to 0–255. The
 * preview shader reads `.r` and overlays it onto the voxel color; the exporter bakes it per color.
 * Stored as raw (non-color) data — consumers must set the texture's colorSpace to no-decode.
 */
export function buildBlendAtlas(texture: TextureModel): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4)
  // Default every pixel to neutral (0.5 blend → 128), so unused/empty atlas regions are no-ops.
  const neutral = Math.round(0.5 * 255)
  for (let i = 0; i < ATLAS_WIDTH * ATLAS_HEIGHT; i++) {
    data[i * 4] = neutral
    data[i * 4 + 1] = neutral
    data[i * 4 + 2] = neutral
    data[i * 4 + 3] = 255
  }

  for (const face of Object.keys(FACE_ATLAS_CELL) as BoxFace[]) {
    const { col, row } = FACE_ATLAS_CELL[face]
    const arr = texture.faces[face]
    for (let tv = 0; tv < FACE_SIZE; tv++) {
      for (let tu = 0; tu < FACE_SIZE; tu++) {
        const value = Math.round(blendForIndex(arr[tv * FACE_SIZE + tu]) * 255)
        const atlasX = col * FACE_SIZE + tu
        const atlasY = row * FACE_SIZE + tv
        const p = (atlasY * ATLAS_WIDTH + atlasX) * 4
        data[p] = value
        data[p + 1] = value
        data[p + 2] = value
      }
    }
  }
  return { data, width: ATLAS_WIDTH, height: ATLAS_HEIGHT }
}
