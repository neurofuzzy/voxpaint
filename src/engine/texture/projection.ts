import { decodeKey } from '@/engine/grid/GridStore'
import { forEachSubdivChild } from '@/engine/grid/subdiv'
import type { GridExtent, VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { worldToTexel } from './boxMapping'
import { texelIndex, withinFace } from './TextureStore'
import { BOX_FACE_AXIS, faceSizeFor, TEXEL_SCALE } from './types'
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
 * the guide lines up exactly with where paint lands on the model. Returns `faceSize²` hex strings,
 * `null` where the model doesn't cover.
 */
export function projectModelToFace(model: VoxelModel, palette: PaletteState, face: BoxFace, gridExtent: GridExtent, texelScale: number = TEXEL_SCALE): (string | null)[] {
  const faceSize = faceSizeFor(gridExtent, texelScale)
  const out = new Array<string | null>(faceSize * faceSize).fill(null)
  if (!model.bounds || (model.color.size === 0 && model.subdiv.size === 0)) return out

  const { axis, orientation } = BOX_FACE_AXIS[face]
  const ai = axisIndex(axis)
  const minC = model.bounds.min[ai]
  const maxC = model.bounds.max[ai]
  const span = Math.max(1, maxC - minC)
  const best = new Float64Array(faceSize * faceSize).fill(-Infinity)

  /** Splat one (possibly sub-cell) voxel's in-plane footprint, frontmost-wins per texel. */
  const splatCell = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, slot: PaletteSlotRef): void => {
    // A voxel spans its size in cells = size × texelScale texels; its two in-plane corners
    // bound its texel block.
    const [u0, v0] = worldToTexel(face, cx, cy, cz, gridExtent, texelScale)
    const [u1, v1] = worldToTexel(face, cx + sx, cy + sy, cz + sz, gridExtent, texelScale)
    const tuMin = Math.round(Math.min(u0, u1))
    const tuMax = Math.round(Math.max(u0, u1))
    const tvMin = Math.round(Math.min(v0, v1))
    const tvMax = Math.round(Math.max(v0, v1))

    const depth = [cx, cy, cz][ai]
    const metric = orientation === 1 ? depth : -depth // larger = frontmost (outward)
    const norm = orientation === 1 ? (depth - minC) / span : (maxC - depth) / span
    const shaded = multiplyHex(resolveSlotColor(palette, slot), DIM_BACK + (DIM_FRONT - DIM_BACK) * norm)

    for (let tv = tvMin; tv < tvMax; tv++) {
      for (let tu = tuMin; tu < tuMax; tu++) {
        if (!withinFace(tu, tv, faceSize)) continue
        const i = texelIndex(tu, tv, faceSize)
        if (metric > best[i]) {
          best[i] = metric
          out[i] = shaded
        }
      }
    }
  }

  for (const [key, cell] of model.color) {
    const c = decodeKey(key)
    splatCell(c[0], c[1], c[2], 1, 1, 1, cell.paletteSlot)
  }
  // Detail children splat at their fractional size (2×2 texels at the default scale for
  // halves) — the guide stays aligned with the subcells exactly like full cells.
  forEachSubdivChild(model, (_parentKey, _index, origin, size, child) => {
    splatCell(origin[0], origin[1], origin[2], size[0], size[1], size[2], child.slot)
  })
  return out
}
