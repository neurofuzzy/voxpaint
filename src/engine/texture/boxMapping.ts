import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { axisIndex, ALL_AXES } from '@/engine/plane/planeGeometry'
import type { Axis, ChamferCell, Coord } from '@/engine/grid/types'
import type { BoxFace, TextureModel } from './types'
import { BOX_FACE_AXIS, boxFaceOf, EMPTY, FACE_SIZE, GRAYSCALE, HALF_WORLD, TEXEL_SCALE } from './types'

// --- Atlas layout: the 6 faces packed into a 3×2 grid -----------------------------------------
const ATLAS_COLS = 3
const ATLAS_ROWS = 2
export const ATLAS_WIDTH = ATLAS_COLS * FACE_SIZE
export const ATLAS_HEIGHT = ATLAS_ROWS * FACE_SIZE

const FACE_ATLAS_CELL: Record<BoxFace, { col: number; row: number }> = {
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
 * Projects a world vertex onto a box face's two in-plane axes, returning **continuous** texel
 * coordinates in `[0, FACE_SIZE]`. Reuses `planeLogicalBasis` so the projection matches the 2D
 * canvas's u/v convention by construction. Orientation-independent (both faces of an axis share the
 * same in-plane mapping) — only `boxFaceForCell` picks which of the two faces a triangle lands on.
 */
export function worldToTexel(face: BoxFace, x: number, y: number, z: number): [number, number] {
  const { axis } = BOX_FACE_AXIS[face]
  const { uDir, vDir } = AXIS_BASIS[axis]
  const p: Coord = [x, y, z]
  const pu = dot(p, uDir)
  const pv = dot(p, vDir)
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

// Precompute grayscale RGB triples once.
const GRAY_RGB = GRAYSCALE.map((hex) => {
  const clean = hex.replace('#', '')
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)] as const
})

/**
 * Rasterizes the 6 texture faces into a single RGBA atlas (3×2 packing). Unpainted texels become
 * opaque white so the shade/multiply material leaves the underlying voxel color unchanged there.
 */
export function buildAtlas(texture: TextureModel): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4)
  data.fill(255) // opaque white everywhere (multiply no-op for unpainted texels)

  for (const face of Object.keys(FACE_ATLAS_CELL) as BoxFace[]) {
    const { col, row } = FACE_ATLAS_CELL[face]
    const arr = texture.faces[face]
    for (let tv = 0; tv < FACE_SIZE; tv++) {
      for (let tu = 0; tu < FACE_SIZE; tu++) {
        const idx = arr[tv * FACE_SIZE + tu]
        if (idx === EMPTY) continue
        const rgb = GRAY_RGB[idx] ?? GRAY_RGB[GRAY_RGB.length - 1]
        const atlasX = col * FACE_SIZE + tu
        const atlasY = row * FACE_SIZE + tv
        const p = (atlasY * ATLAS_WIDTH + atlasX) * 4
        data[p] = rgb[0]
        data[p + 1] = rgb[1]
        data[p + 2] = rgb[2]
        data[p + 3] = 255
      }
    }
  }
  return { data, width: ATLAS_WIDTH, height: ATLAS_HEIGHT }
}
