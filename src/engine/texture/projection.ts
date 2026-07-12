import { decodeKey } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { worldToTexel } from './boxMapping'
import { texelIndex, withinFace } from './TextureStore'
import { BOX_FACE_AXIS, FACE_SIZE } from './types'
import type { BoxFace } from './types'

/** Darkens/desaturates a `#rrggbb` by multiplying each channel by `f` (clamped). */
function multiplyHex(hex: string, f: number): string {
  const c = hex.replace('#', '')
  const ch = (o: number) => {
    const v = Math.max(0, Math.min(255, Math.round(parseInt(c.slice(o, o + 2), 16) * f)))
    return v.toString(16).padStart(2, '0')
  }
  return `#${ch(0)}${ch(2)}${ch(4)}`
}

// Overall dimming so the projection clearly reads as "underneath" the paint, plus a depth ramp
// (frontmost voxels brighter) so the model's shape is legible, not a flat silhouette.
const DIM_BACK = 0.32
const DIM_FRONT = 0.62

/**
 * Renders the model's silhouette onto a box face's texel grid, as a paint-alignment guide behind
 * the texture canvas. For each texel it keeps the **frontmost** voxel along the face's axis (nearest
 * the outside), shaded by depth and dimmed. Uses the same `worldToTexel` mapping the 3D UVs use, so
 * the guide lines up exactly with where paint lands on the model. Returns `FACE_SIZE²` hex strings,
 * `null` where the model doesn't cover.
 */
export function projectModelToFace(model: VoxelModel, palette: PaletteState, face: BoxFace): (string | null)[] {
  const out = new Array<string | null>(FACE_SIZE * FACE_SIZE).fill(null)
  if (!model.bounds || model.color.size === 0) return out

  const { axis, orientation } = BOX_FACE_AXIS[face]
  const ai = axisIndex(axis)
  const minC = model.bounds.min[ai]
  const maxC = model.bounds.max[ai]
  const span = Math.max(1, maxC - minC)
  const best = new Float64Array(FACE_SIZE * FACE_SIZE).fill(-Infinity)

  for (const [key, cell] of model.color) {
    const c = decodeKey(key)
    // A voxel spans one cell = TEXEL_SCALE texels; its two in-plane corners bound its texel block.
    const [u0, v0] = worldToTexel(face, c[0], c[1], c[2])
    const [u1, v1] = worldToTexel(face, c[0] + 1, c[1] + 1, c[2] + 1)
    const tuMin = Math.round(Math.min(u0, u1))
    const tuMax = Math.round(Math.max(u0, u1))
    const tvMin = Math.round(Math.min(v0, v1))
    const tvMax = Math.round(Math.max(v0, v1))

    const depth = c[ai]
    const metric = orientation === 1 ? depth : -depth // larger = frontmost (outward)
    const norm = orientation === 1 ? (depth - minC) / span : (maxC - depth) / span
    const shaded = multiplyHex(resolveSlotColor(palette, cell.paletteSlot), DIM_BACK + (DIM_FRONT - DIM_BACK) * norm)

    for (let tv = tvMin; tv < tvMax; tv++) {
      for (let tu = tuMin; tu < tuMax; tu++) {
        if (!withinFace(tu, tv)) continue
        const i = texelIndex(tu, tv)
        if (metric > best[i]) {
          best[i] = metric
          out[i] = shaded
        }
      }
    }
  }
  return out
}
