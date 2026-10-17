import type { Axis, Coord, GridExtent } from '@/engine/grid/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { SelectionTransformKind } from '@/store/types'
import { texelCenterToWorld, worldToTexel } from './boxMapping'
import { withinFace } from './TextureStore'
import { BOX_FACE_AXIS, BOX_FACES, EMPTY, TEXEL_SCALE, boxFaceOf, faceSizeFor, halfWorldFor } from './types'
import type { BoxFace, TextureModel } from './types'

const mod = (n: number, m: number): number => ((n % m) + m) % m

/**
 * Inverse of the whole-model voxel rigid transform for a `(planeAxis, kind)` pair, in continuous
 * world coordinates about the grid origin (no corner-index `-1` terms — those are discrete cell
 * artifacts; the box `[-half, half]` is invariant under these maps). Mirrors the logical-frame
 * semantics of `rotateClipboard90`/`mirrorClipboard` that `transformWholeModel` runs the voxels
 * through, so sampling `old(worldToTexel(src, Finv(P)))` keeps every texel glued to its voxel.
 */
function inverseWorldPoint(kind: SelectionTransformKind, planeAxis: Axis, p: Coord): Coord {
  const [x, y, z] = p
  switch (planeAxis) {
    case 'z':
      switch (kind) {
        case 'rotate': return [-y, x, z]
        case 'rotate-ccw': return [y, -x, z]
        case 'mirror-h': return [-x, y, z]
        case 'mirror-v': return [x, -y, z]
      }
      break
    case 'x':
      switch (kind) {
        case 'rotate': return [x, -z, y]
        case 'rotate-ccw': return [x, z, -y]
        case 'mirror-h': return [x, y, -z]
        case 'mirror-v': return [x, -y, z]
      }
      break
    case 'y':
      switch (kind) {
        case 'rotate': return [-z, y, x]
        case 'rotate-ccw': return [z, y, -x]
        case 'mirror-h': return [-x, y, z]
        case 'mirror-v': return [x, y, -z]
      }
      break
  }
  throw new Error(`unhandled whole-model texture transform ${kind} on ${planeAxis}`)
}

/** Which source face's paint a destination face shows after the whole-model transform. */
function sourceFaceFor(kind: SelectionTransformKind, planeAxis: Axis, dst: BoxFace): BoxFace {
  const { axis, orientation } = BOX_FACE_AXIS[dst]
  const n: Coord = [0, 0, 0]
  n[axisIndex(axis)] = orientation
  const s = inverseWorldPoint(kind, planeAxis, n)
  const si = s[0] !== 0 ? 0 : s[1] !== 0 ? 1 : 2
  const sAxis: Axis = si === 0 ? 'x' : si === 1 ? 'y' : 'z'
  return boxFaceOf(sAxis, s[si] >= 0 ? 1 : -1)
}

/**
 * Translates every texture face by a whole-model world delta (integer voxels), wrapping
 * toroidally so paint that scrolls off one edge re-enters on the opposite edge — nothing is
 * ever lost. Faces whose normal is the delta axis are invariant (depth, not in-plane motion)
 * and copy through byte-identical. Pure; the input is never mutated.
 */
export function translateTextureModelWrap(
  texture: TextureModel,
  delta: Coord,
  gridExtent: GridExtent,
  texelScale: number = TEXEL_SCALE,
): TextureModel {
  const faceSize = faceSizeFor(gridExtent, texelScale)
  const faces = {} as Record<BoxFace, Uint8Array>
  for (const face of BOX_FACES) {
    // worldToTexel is affine in-plane, so differencing probes yields the exact integer shift.
    const [ax, ay] = worldToTexel(face, delta[0], delta[1], delta[2], gridExtent, texelScale)
    const [ox, oy] = worldToTexel(face, 0, 0, 0, gridExtent, texelScale)
    const shiftU = Math.round(ax - ox)
    const shiftV = Math.round(ay - oy)
    const src = texture.faces[face]
    const out = new Uint8Array(faceSize * faceSize)
    if (shiftU === 0 && shiftV === 0) {
      out.set(src)
    } else {
      for (let v = 0; v < faceSize; v++) {
        const sv = mod(v - shiftV, faceSize)
        for (let u = 0; u < faceSize; u++) {
          out[v * faceSize + u] = src[sv * faceSize + mod(u - shiftU, faceSize)]
        }
      }
    }
    faces[face] = out
  }
  return { faces }
}

/**
 * Remaps the six box-map faces for a whole-model rotate/mirror in the given plane's frame: side
 * faces permute slots (the face that turns into +X shows what +X now displays), while the two
 * cap faces orthogonal to the turn axis stay in their slot but spin/flip in-plane so their
 * paint stays glued to the voxels underneath. Implemented as an exact discrete permutation via
 * `texelCenterToWorld` → inverse voxel transform → `worldToTexel` + `floor` — all coordinates
 * stay on exact binary fractions (halves/quarters), so the boundaries never wobble and no
 * resampling/blur is involved. Pure; the input is never mutated.
 */
export function transformTextureWholeModel(
  texture: TextureModel,
  kind: SelectionTransformKind,
  planeAxis: Axis,
  gridExtent: GridExtent,
  texelScale: number = TEXEL_SCALE,
): TextureModel {
  const faceSize = faceSizeFor(gridExtent, texelScale)
  const half = halfWorldFor(gridExtent)
  const surfaceDepth: Record<BoxFace, number> = {
    px: half, nx: -half, py: half, ny: -half, pz: half, nz: -half,
  }
  const faces = {} as Record<BoxFace, Uint8Array>
  for (const dst of BOX_FACES) {
    const src = sourceFaceFor(kind, planeAxis, dst)
    const srcArr = texture.faces[src]
    const out = new Uint8Array(faceSize * faceSize)
    for (let tv = 0; tv < faceSize; tv++) {
      for (let tu = 0; tu < faceSize; tu++) {
        const p = texelCenterToWorld(dst, tu, tv, surfaceDepth[dst], gridExtent, texelScale)
        const q = inverseWorldPoint(kind, planeAxis, p)
        const [suC, svC] = worldToTexel(src, q[0], q[1], q[2], gridExtent, texelScale)
        const su = Math.floor(suC)
        const sv = Math.floor(svC)
        out[tv * faceSize + tu] = withinFace(su, sv, faceSize) ? srcArr[sv * faceSize + su] : EMPTY
      }
    }
    faces[dst] = out
  }
  return { faces }
}

/** Byte-exact equality of two textures' faces (lengths included). Used to skip junk undo steps
 * when a whole-model gesture nets out to no texture change (e.g. a full-wrap move). */
export function textureContentEquals(a: TextureModel, b: TextureModel): boolean {
  for (const f of BOX_FACES) {
    const A = a.faces[f]
    const B = b.faces[f]
    if (A.length !== B.length) return false
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false
  }
  return true
}
