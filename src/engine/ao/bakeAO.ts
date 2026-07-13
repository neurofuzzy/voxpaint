import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import type { Coord, VoxelModel } from '@/engine/grid/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { ATLAS_HEIGHT, ATLAS_WIDTH, FACE_ATLAS_CELL, texelCenterToWorld, worldToTexel } from '@/engine/texture/boxMapping'
import { texelIndex, withinFace } from '@/engine/texture/TextureStore'
import { BOX_FACES, BOX_FACE_AXIS, FACE_SIZE } from '@/engine/texture/types'
import { AO_OPTIONS, AO_SEARCH_RADIUS, AO_STRENGTH } from './aoConstants'
import { computeVoxelAO, type Vec3 } from './voxelAO'

/**
 * Bakes ambient occlusion into an atlas texture at the **same resolution and layout as the box-map
 * paint atlas** (`TEXEL_SCALE`, i.e. each texel = 0.25 voxel; 3×2 face packing). The result is a
 * grayscale RGBA map meant to be applied as a `MeshPhysicalMaterial.map` so the surface reads
 * `baseColor × ao` (a true multiply, not a flat overlay). Aligns with the texture UVs by construction,
 * so AO shading sits exactly where paint would.
 *
 * For each box face, each texel keeps the **frontmost** voxel along the face axis (same rule as the
 * silhouette guide in `texture/projection.ts`), then samples AO at that voxel's outer-surface point —
 * on the surface plane, so the sample's own voxel and its coplanar neighbours sit behind the plane and
 * never self-occlude. Occluders are the model's other voxels (by centre), gathered per frontmost voxel
 * within the search radius so the cost stays local rather than O(texels · voxels).
 */
export function bakeAOAtlas(model: VoxelModel, options = AO_OPTIONS): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4)
  // Default every atlas pixel to fully lit (ao = 1 → ×1 no-op), opaque.
  data.fill(255)
  if (!model.bounds || model.color.size === 0) return { data, width: ATLAS_WIDTH, height: ATLAS_HEIGHT }

  const occupied = model.color // Map<CellKey, …>; membership = a solid voxel occludes
  const radius = Math.ceil(AO_SEARCH_RADIUS) + 1 // +1: the surface sample sits up to a voxel off-centre
  const occluderCache = new Map<string, Vec3[]>()

  const gatherOccluders = (key: string, c: Coord): Vec3[] => {
    let local = occluderCache.get(key)
    if (local) return local
    local = []
    for (let x = c[0] - radius; x <= c[0] + radius; x++) {
      for (let y = c[1] - radius; y <= c[1] + radius; y++) {
        for (let z = c[2] - radius; z <= c[2] + radius; z++) {
          if (occupied.has(encodeKey(x, y, z))) local.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5 })
        }
      }
    }
    occluderCache.set(key, local)
    return local
  }

  for (const face of BOX_FACES) {
    const { axis, orientation } = BOX_FACE_AXIS[face]
    const ai = axisIndex(axis)
    const { col, row } = FACE_ATLAS_CELL[face]

    // Pass 1: frontmost voxel per texel (largest outward coordinate along the face axis).
    const best = new Float64Array(FACE_SIZE * FACE_SIZE).fill(-Infinity)
    const front: (string | null)[] = new Array(FACE_SIZE * FACE_SIZE).fill(null)
    for (const key of occupied.keys()) {
      const c = decodeKey(key)
      const [u0, v0] = worldToTexel(face, c[0], c[1], c[2])
      const [u1, v1] = worldToTexel(face, c[0] + 1, c[1] + 1, c[2] + 1)
      const tuMin = Math.round(Math.min(u0, u1))
      const tuMax = Math.round(Math.max(u0, u1))
      const tvMin = Math.round(Math.min(v0, v1))
      const tvMax = Math.round(Math.max(v0, v1))
      const metric = orientation === 1 ? c[ai] : -c[ai]
      for (let tv = tvMin; tv < tvMax; tv++) {
        for (let tu = tuMin; tu < tuMax; tu++) {
          if (!withinFace(tu, tv)) continue
          const i = texelIndex(tu, tv)
          if (metric > best[i]) {
            best[i] = metric
            front[i] = key
          }
        }
      }
    }

    // Pass 2: sample AO at each covered texel's world position on the frontmost voxel's outer face.
    const normal: Coord = [0, 0, 0]
    normal[ai] = orientation
    for (let tv = 0; tv < FACE_SIZE; tv++) {
      for (let tu = 0; tu < FACE_SIZE; tu++) {
        const key = front[texelIndex(tu, tv)]
        if (!key) continue
        const c = decodeKey(key)
        const depthCoord = orientation === 1 ? c[ai] + 1 : c[ai] // outer surface plane along the axis
        const [wx, wy, wz] = texelCenterToWorld(face, tu, tv, depthCoord)
        const occluders = gatherOccluders(key, c)
        const ao = computeVoxelAO([{ position: { x: wx, y: wy, z: wz }, normal: { x: normal[0], y: normal[1], z: normal[2] } }], occluders, options)[0]
        const shaded = 1 - AO_STRENGTH * (1 - ao)
        const value = Math.round(shaded * 255)
        const px = ((row * FACE_SIZE + tv) * ATLAS_WIDTH + (col * FACE_SIZE + tu)) * 4
        data[px] = value
        data[px + 1] = value
        data[px + 2] = value
      }
    }
  }

  return { data, width: ATLAS_WIDTH, height: ATLAS_HEIGHT }
}
