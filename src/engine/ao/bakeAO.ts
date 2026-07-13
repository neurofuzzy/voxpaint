import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { AO_STRENGTH } from './aoConstants'
import type { UnwrappedAtlas } from './uvUnwrap'

const TEXELS_PER_UNIT = 4
const PADDING = 1
const CELL_SIZE = 1 / TEXELS_PER_UNIT // 0.25 world units
const SEARCH_RADIUS_CELLS = 32 // 8 world units — wide enough for smooth falloff

/**
 * Builds a high-resolution 3D occupancy grid (TEXELS_PER_UNIT cells per world unit).
 * Each occupied voxel fills a TEXELS_PER_UNIT³ block.
 */
function buildOccGrid(model: VoxelModel): {
  grid: Uint8Array
  gx: number; gy: number; gz: number
  min: [number, number, number]
} | null {
  if (!model.bounds) return null
  const { min, max } = model.bounds
  const wx = max[0] - min[0] + 1
  const wy = max[1] - min[1] + 1
  const wz = max[2] - min[2] + 1
  const gx = wx * TEXELS_PER_UNIT
  const gy = wy * TEXELS_PER_UNIT
  const gz = wz * TEXELS_PER_UNIT
  const grid = new Uint8Array(gx * gy * gz)

  for (const key of model.color.keys()) {
    const [x, y, z] = decodeKey(key)
    const bx = (x - min[0]) * TEXELS_PER_UNIT
    const by = (y - min[1]) * TEXELS_PER_UNIT
    const bz = (z - min[2]) * TEXELS_PER_UNIT
    for (let dx = 0; dx < TEXELS_PER_UNIT; dx++) {
      for (let dy = 0; dy < TEXELS_PER_UNIT; dy++) {
        for (let dz = 0; dz < TEXELS_PER_UNIT; dz++) {
          grid[(bx + dx) + (by + dy) * gx + (bz + dz) * gx * gy] = 1
        }
      }
    }
  }

  return { grid, gx, gy, gz, min: [min[0], min[1], min[2]] }
}

/**
 * Precomputed hemisphere ray directions in tangent space (normal = +Y).
 * Generated over a hemisphere centered on the surface normal, covering all
 * directions from straight-ahead to grazing. Used for ray-cast AO.
 */
function buildHemisphereDirs(): [number, number, number][] {
  const dirs: [number, number, number][] = []

  // Sample points in the upper hemisphere of a sphere (θ ∈ [0, π/2], φ ∈ [0, 2π]).
  // Directions in tangent space: (sinθ·cosφ, cosθ, sinθ·sinφ).
  // 5 polar rings × 16 azimuthal samples = 80 directions.
  for (let p = 0; p < 5; p++) {
    const theta = (p + 0.5) * (Math.PI / 2) / 5 // 9°, 27°, 45°, 63°, 81° from normal
    const sinT = Math.sin(theta)
    const cosT = Math.cos(theta)
    const azimuthalSteps = p === 0 ? 1 : 16
    for (let a = 0; a < azimuthalSteps; a++) {
      const phi = a * (2 * Math.PI) / azimuthalSteps
      dirs.push([sinT * Math.cos(phi), cosT, sinT * Math.sin(phi)])
    }
  }

  return dirs
}

/** Precomputed once — the same set of directions works for any face normal via basis transform. */
let _hemisphereDirs: [number, number, number][] | null = null
function hemisphereDirs(): [number, number, number][] {
  if (!_hemisphereDirs) _hemisphereDirs = buildHemisphereDirs()
  return _hemisphereDirs
}

/**
 * Bakes ambient occlusion into a uv1-unwrapped atlas via hemisphere ray-casting.
 * For each texel, casts rays into the 4× occupancy grid along precomputed
 * hemisphere directions. Occlusion from each ray is 1/(1 + hitDist²); the
 * average across all rays gives the per-texel AO value. Nearby occluding
 * geometry blocks more rays at shorter distances → darker AO with smooth falloff.
 */
export function bakeAOToAtlas(model: VoxelModel, atlas: UnwrappedAtlas): {
  data: Uint8ClampedArray
  width: number
  height: number
} {
  const { size } = atlas
  const data = new Uint8ClampedArray(size * size * 4)
  data.fill(255)

  const occ = buildOccGrid(model)
  if (!occ) return { data, width: size, height: size }

  const { grid, gx, gy, gz, min: occMin } = occ
  const dirs = hemisphereDirs()

  for (const rect of atlas.rects) {
    const { normal, tangent1: t1, tangent2: t2 } = rect

    for (let ty = PADDING; ty < rect.texHeight - PADDING; ty++) {
      for (let tx = PADDING; tx < rect.texWidth - PADDING; tx++) {
        const worldU = rect.minU + (tx - PADDING + 0.5) / TEXELS_PER_UNIT
        const worldV = rect.minV + (ty - PADDING + 0.5) / TEXELS_PER_UNIT

        const wx = normal.x * rect.depthCoord + t1.x * worldU + t2.x * worldV
        const wy = normal.y * rect.depthCoord + t1.y * worldU + t2.y * worldV
        const wz = normal.z * rect.depthCoord + t1.z * worldU + t2.z * worldV

        // Grid cell of the surface texel (no nudge — exact surface position).
        const sx = Math.round((wx - occMin[0]) * TEXELS_PER_UNIT) - 1;
        const sy = Math.round((wy - occMin[1]) * TEXELS_PER_UNIT) - 1;
        const sz = Math.round((wz - occMin[2]) * TEXELS_PER_UNIT) - 1;

        let totalOcclusion = 0

        for (const [dt, dd, dt2] of dirs) {
          // Transform direction from tangent space to world (grid) space
          const dx = dd * normal.x + dt * t1.x + dt2 * t2.x
          const dy = dd * normal.y + dt * t1.y + dt2 * t2.y
          const dz = dd * normal.z + dt * t1.z + dt2 * t2.z

          // Ray-cast through the occupancy grid. Step through grid cells along
          // the direction; first occupied cell hit determines per-ray occlusion.
          let hitDistCells = Infinity
          for (let step = 1; step < SEARCH_RADIUS_CELLS; step++) {
            const gx2 = Math.round(sx + dx * step)
            const gy2 = Math.round(sy + dy * step)
            const gz2 = Math.round(sz + dz * step)
            if (gx2 < 0 || gx2 >= gx || gy2 < 0 || gy2 >= gy || gz2 < 0 || gz2 >= gz) break

            // Skip cells behind or level with the surface to avoid self-occlusion
            // from the face's own voxel when rays sweep tangent.
            const ahead = (gx2 - sx) * normal.x + (gy2 - sy) * normal.y + (gz2 - sz) * normal.z
            if (ahead <= 0.5) continue

            if (grid[gx2 + gy2 * gx + gz2 * gx * gy] === 1) {
              hitDistCells = step
              break
            }
          }

          if (hitDistCells < Infinity) {
            const hitDist = hitDistCells * CELL_SIZE
            totalOcclusion += 1 / (1.0 + hitDist)
          }
        }

        const ao = totalOcclusion / dirs.length
        const shaded = 1 - AO_STRENGTH * ao
        const value = Math.round(Math.max(0, Math.min(1, shaded)) * 255)

        const atlasX = rect.atlasX + tx
        const atlasY = rect.atlasY + ty
        const px = (atlasY * size + atlasX) * 4
        data[px] = value
        data[px + 1] = value
        data[px + 2] = value
      }
    }
  }

  return { data, width: size, height: size }
}

/**
 * Builds a 3D occupancy texture from the model's occupied voxels.
 * Each cell is 1 byte (RedFormat, UnsignedByteType) — 255 = occupied.
 * Available for potential future shader-based per-fragment AO.
 */
export function bakeOccupancyField(model: VoxelModel): THREE.Data3DTexture | null {
  if (!model.bounds) return null
  const { min, max } = model.bounds
  const wx = max[0] - min[0] + 1
  const wy = max[1] - min[1] + 1
  const wz = max[2] - min[2] + 1
  const data = new Uint8Array(wx * wy * wz)
  for (const key of model.color.keys()) {
    const [x, y, z] = decodeKey(key)
    const ix = x - min[0]; const iy = y - min[1]; const iz = z - min[2]
    data[ix + iy * wx + iz * wx * wy] = 255
  }
  const tex = new THREE.Data3DTexture(data, wx, wy, wz)
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}
