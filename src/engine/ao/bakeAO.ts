import * as THREE from 'three'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import { splitChildOrigin, splitChildSize } from '@/engine/grid/subdiv'
import type { CellKey, Coord, VoxelModel } from '@/engine/grid/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { outwardNormal } from '@/engine/plane/planeGeometry'
import { rotateLocal } from '@/engine/chamfer/rampDual'
import type { UnwrappedAtlas, UnwrappedRect } from './uvUnwrap'

const TEXELS_PER_UNIT = 4
const PADDING = 1
const CELL_SIZE = 1 / TEXELS_PER_UNIT // 0.25 world units
const SEARCH_RADIUS_CELLS = 32 // 8 world units — wide enough for smooth falloff

/**
 * Deterministic position-based pseudo-random hash producing a value in [0, 1].
 * Same world-space position (and `seed`) always yields the same noise — static surface grain
 * suitable for simulating dust, dirt, and subtle surface variation baked into the AO texture.
 * `seed` (default 0, i.e. unseeded — matches pre-seed behavior for old projects) folds in via its
 * own large prime so different projects get visually distinct noise instead of every project
 * sharing the exact same grain at the same voxel coordinates.
 */
export function hashNoise(wx: number, wy: number, wz: number, seed = 0): number {
  let h = wx * 374761393 + wy * 668265263 + wz * 1274126177 + seed * 2246822519
  h = (h ^ (h >> 13)) * 1274126177
  h = h ^ (h >> 16)
  return (h & 0x7fffffff) / 0x7fffffff
}

/** Same deterministic hash as `hashNoise` but with a different prime set (including for `seed`) so
 * the noise pattern is decorrelated from the AO noise even under the same project seed — useful for
 * a separate specular-colour grain on metal materials. */
export function specularHash(wx: number, wy: number, wz: number, seed = 0): number {
  let h = wx * 1597334677 + wy * 3266487767 + wz * 2503832273 + seed * 3266489917
  h = (h ^ (h >> 13)) * 2503832273
  h = h ^ (h >> 16)
  return (h & 0x7fffffff) / 0x7fffffff
}

/** Fresh random per-project noise seed, generated once at project creation (`newProject`) and
 * persisted in `ProjectMeta` so `hashNoise`/`specularHash` reproduce the same grain on reload while
 * differing from every other project's. */
export function generateNoiseSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

/**
 * Grain cell size in atlas texels, clamped to the supported 1/2/4 set: 1 hashes every texel
 * individually, 2/4 hash one value per 2×2 / 4×4 block (nearest-quantized, never blurred).
 */
function blockScale(noiseScale: number): 1 | 2 | 4 {
  return noiseScale >= 4 ? 4 : noiseScale >= 2 ? 2 : 1
}

/**
 * Fills an RGBA texture of the given size with specular-colour noise whose R, G and B channels are
 * all set to `1 − specularNoiseLevel × hash(worldPos)` so the noise uniformly darkens the specular
 * reflection in a per-pixel decorrelated pattern from the AO grain.
 */
export function makeSpecularNoiseTexture(
  atlas: UnwrappedAtlas,
  level: number,
  seed = 0,
  noiseScale: number = 1,
): {
  metalness: { data: Uint8ClampedArray; width: number; height: number }
  roughness: { data: Uint8ClampedArray; width: number; height: number }
  baseColor: { data: Uint8ClampedArray; width: number; height: number }
} {
  const size4 = atlas.size * atlas.size * 4
  const m = new Uint8ClampedArray(size4); m.fill(255)
  const r = new Uint8ClampedArray(size4); r.fill(51)
  const b = new Uint8ClampedArray(size4); b.fill(255)
  if (level <= 0) return {
    metalness: { data: m, width: atlas.size, height: atlas.size },
    roughness: { data: r, width: atlas.size, height: atlas.size },
    baseColor: { data: b, width: atlas.size, height: atlas.size },
  }

  const bs = blockScale(noiseScale)
  for (const rect of atlas.rects) {
    for (let ty = PADDING; ty < rect.texHeight - PADDING; ty++) {
      for (let tx = PADDING; tx < rect.texWidth - PADDING; tx++) {
        const u = rect.minU + (tx - PADDING + 0.5) / TEXELS_PER_UNIT
        const v = rect.minV + (ty - PADDING + 0.5) / TEXELS_PER_UNIT
        const wx = rect.normal.x * rect.depthCoord + rect.tangent1.x * u + rect.tangent2.x * v
        const wy = rect.normal.y * rect.depthCoord + rect.tangent1.y * u + rect.tangent2.y * v
        const wz = rect.normal.z * rect.depthCoord + rect.tangent1.z * u + rect.tangent2.z * v
        const n = specularHash(
          Math.floor((wx * TEXELS_PER_UNIT) / bs),
          Math.floor((wy * TEXELS_PER_UNIT) / bs),
          Math.floor((wz * TEXELS_PER_UNIT) / bs),
          seed,
        )
        const rust = Math.max(0, Math.min(1, level * n))
        const idx = ((rect.atlasY + ty) * atlas.size + (rect.atlasX + tx)) * 4

        const mv = Math.round((1 - rust) * 255)
        m[idx] = mv; m[idx + 1] = mv; m[idx + 2] = mv
        const rv = Math.round((0.2 + 0.8 * rust) * 255)
        r[idx] = rv; r[idx + 1] = rv; r[idx + 2] = rv
        // Base colour: grayscale darkening proportional to rust, no tint
        const cv = Math.round(Math.max(0, 0.5 - rust * 0.45) * 255)
        b[idx] = cv; b[idx + 1] = cv; b[idx + 2] = cv
      }
    }
  }

  return {
    metalness: { data: m, width: atlas.size, height: atlas.size },
    roughness: { data: r, width: atlas.size, height: atlas.size },
    baseColor: { data: b, width: atlas.size, height: atlas.size },
  }
}

/**
 * Builds a high-resolution 3D occupancy grid (TEXELS_PER_UNIT cells per world unit).
 * Each occupied voxel fills a TEXELS_PER_UNIT³ block; each live detail child fills an exact
 * half-unit (TEXELS_PER_UNIT/2)³ block at its half origin — the same volume the plain cube
 * filled, so occlusion never shifts when a cell is subdivided.
 *
 * `excludeKeys`, when given, omits those cells from the occupancy grid entirely — used to keep
 * animated-slice voxels from acting as AO occluders for the rest of the model, since they won't
 * be in their rest-pose position once the exported animation plays.
 */
export function buildOccGrid(model: VoxelModel, excludeKeys?: Set<CellKey>): {
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
    if (model.chamfer.has(key)) continue
    if (excludeKeys?.has(key)) continue
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

  // Detail children fill fractional texel blocks (size × TEXELS_PER_UNIT per axis) at their
  // exact origins — occluders at the same resolution the rays march, so contact shadows from
  // detail read correctly. Erased children stay empty.
  for (const [parentKey, sub] of model.subdiv) {
    if (excludeKeys?.has(parentKey)) continue
    const parent = decodeKey(parentKey)
    const [sx, sy, sz] = splitChildSize(sub.split)
    const tx = Math.round(sx * TEXELS_PER_UNIT)
    const ty = Math.round(sy * TEXELS_PER_UNIT)
    const tz = Math.round(sz * TEXELS_PER_UNIT)
    for (let o = 0; o < sub.children.length; o++) {
      if (!sub.children[o]) continue
      const [ox, oy, oz] = splitChildOrigin(parent, sub.split, o)
      const bx = Math.round((ox - min[0]) * TEXELS_PER_UNIT)
      const by = Math.round((oy - min[1]) * TEXELS_PER_UNIT)
      const bz = Math.round((oz - min[2]) * TEXELS_PER_UNIT)
      for (let dx = 0; dx < tx; dx++) {
        for (let dy = 0; dy < ty; dy++) {
          for (let dz = 0; dz < tz; dz++) {
            grid[(bx + dx) + (by + dy) * gx + (bz + dz) * gx * gy] = 1
          }
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
 * Conservative per-rect empty-ahead test for the AO bake. A texel can only be occluded by an
 * occupied grid cell strictly ahead of its own row (the march only counts hits with
 * `ahead > 0.5`, and both rows are integers on axis-aligned faces) and within 31 steps along
 * each axis. For an axis-aligned rect the texel row along the normal is uniform, so scanning
 * the ahead slab (plus a generous tangent margin) decides for the whole rect at once: empty
 * means every texel bakes zero occlusion and the ray march is skipped entirely.
 *
 * Only exact axis normals qualify (face normals from axis-aligned geometry are exactly ±1,
 * and the tangent basis then carries no normal component, so all texels share one depth);
 * anything else returns false and bakes the full march. When the slab is empty the output is
 * bit-identical to marching (totalOcclusion stays 0 either way) — this only skips provably
 * dead work, and makes bare/convex surfaces (e.g. the outside of a solid cube) bake in
 * microseconds instead of milliseconds.
 */
function rectAheadIsEmpty(
  grid: Uint8Array,
  gx: number, gy: number, gz: number,
  ox: number, oy: number, oz: number,
  rect: UnwrappedRect,
): boolean {
  const nx = rect.normal.x, ny = rect.normal.y, nz = rect.normal.z
  const a = nx === 1 || nx === -1 ? 0 : ny === 1 || ny === -1 ? 1 : nz === 1 || nz === -1 ? 2 : -1
  if (a === -1) return false
  const t1 = rect.tangent1, t2 = rect.tangent2
  const t1a = a === 0 ? t1.x : a === 1 ? t1.y : t1.z
  const t2a = a === 0 ? t2.x : a === 1 ? t2.y : t2.z
  if (t1a !== 0 || t2a !== 0) return false

  const sign = a === 0 ? nx : a === 1 ? ny : nz // 1 or -1
  const omin = a === 0 ? ox : a === 1 ? oy : oz
  // Uniform texel row along the normal — the same value the per-texel start-cell formula
  // yields for every texel (their normal-axis world coordinate is exactly sign * depthCoord).
  const S = Math.round((sign * rect.depthCoord - omin) * TEXELS_PER_UNIT) - 1

  // Tangent footprint from the rect corners, in start-cell space (matches the per-texel
  // formula `(w - omin) * 4 - 1`); the ±MARGIN covers ray reach (31 steps), rounding, and
  // texel centres landing up to half a texel outside the nominal bounds.
  const MARGIN = 34
  const { minU, maxU, minV, maxV, depthCoord: D } = rect
  let b0 = Infinity, b1 = -Infinity, c0 = Infinity, c1 = -Infinity
  for (const [uu, vv] of [[minU, minV], [minU, maxV], [maxU, minV], [maxU, maxV]] as const) {
    const wx = nx * D + t1.x * uu + t2.x * vv
    const wy = ny * D + t1.y * uu + t2.y * vv
    const wz = nz * D + t1.z * uu + t2.z * vv
    // The two tangent world axes (everything but a).
    const w = a === 0 ? [wy, wz] : a === 1 ? [wx, wz] : [wx, wy]
    const o = a === 0 ? [oy, oz] : a === 1 ? [ox, oz] : [ox, oy]
    for (let k = 0; k < 2; k++) {
      const cs = (w[k] - o[k]) * TEXELS_PER_UNIT - 1
      if (k === 0) { b0 = Math.min(b0, cs); b1 = Math.max(b1, cs) }
      else { c0 = Math.min(c0, cs); c1 = Math.max(c1, cs) }
    }
  }
  const lo: [number, number, number] = [0, 0, 0]
  const hi: [number, number, number] = [gx - 1, gy - 1, gz - 1]
  // Normal axis: only rows strictly ahead of S can ever count as hits (integer ahead ≥ 1).
  if (sign > 0) { lo[a] = Math.max(lo[a], S + 1); hi[a] = Math.min(hi[a], S + SEARCH_RADIUS_CELLS) }
  else { lo[a] = Math.max(lo[a], S - SEARCH_RADIUS_CELLS); hi[a] = Math.min(hi[a], S - 1) }
  const tb = a === 0 ? [1, 2] : a === 1 ? [0, 2] : [0, 1]
  const tbBounds = [[b0, b1], [c0, c1]]
  for (let k = 0; k < 2; k++) {
    const ax2 = tb[k]
    lo[ax2] = Math.max(lo[ax2], Math.floor(tbBounds[k][0]) - MARGIN)
    hi[ax2] = Math.min(hi[ax2], Math.ceil(tbBounds[k][1]) + MARGIN)
  }
  if (lo[0] > hi[0] || lo[1] > hi[1] || lo[2] > hi[2]) return true

  const [lx, ly, lz] = lo
  const [hx, hy, hz] = hi
  const strideY = gx, strideZ = gx * gy
  for (let z = lz; z <= hz; z++) {
    for (let y = ly; y <= hy; y++) {
      const row = z * strideZ + y * strideY
      for (let x = lx; x <= hx; x++) {
        if (grid[row + x] === 1) return false
      }
    }
  }
  return true
}

/**
 * Bakes ambient occlusion into a uv1-unwrapped atlas via hemisphere ray-casting.
 * For each texel, casts rays into the 4× occupancy grid along precomputed
 * hemisphere directions. Occlusion from each ray is 1/(1 + hitDist²); the
 * average across all rays gives the per-texel AO value. Nearby occluding
 * geometry blocks more rays at shorter distances → darker AO with smooth falloff.
 */
export function bakeAOToAtlas(
  model: VoxelModel,
  atlas: UnwrappedAtlas,
  noiseLevel = 0,
  aoStrength = 1,
  excludeKeys?: Set<CellKey>,
  seed = 0,
  noiseScale: number = 1,
): {
  data: Uint8ClampedArray
  width: number
  height: number
} {
  const { size } = atlas
  const data = new Uint8ClampedArray(size * size * 4)
  data.fill(255)

  const occ = buildOccGrid(model, excludeKeys)
  if (!occ) return { data, width: size, height: size }

  // Zero-thickness flats neither cast (absent from the occupancy grid above, like every chamfer
  // cell) nor receive AO: a glass pane must not catch contact shadows, so its texels bake
  // constant white. Each flat's world quad plane (unit normal + centre) is derived from its
  // frozen authoring basis — the same convention the geometry prefabs use.
  const flatByCell = new Map<string, { nx: number; ny: number; nz: number; cx: number; cy: number; cz: number }>()
  for (const [key, cell] of model.chamfer) {
    const resolved = cell.resolvedTo
    if (!resolved || (resolved.shapeKind !== 'flat' && resolved.shapeKind !== 'flatwedge')) continue
    const { uDir: U, vDir: V } = planeLogicalBasis(cell.planeAxis)
    const W = outwardNormal(cell.planeAxis, cell.planeOrientation)
    let n: Coord
    if (resolved.shapeKind === 'flat') {
      n = W
    } else {
      const [u, v, w] = rotateLocal([1, -1, 0], resolved.rotation)
      n = [
        u * U[0] + v * V[0] + w * W[0],
        u * U[1] + v * V[1] + w * W[1],
        u * U[2] + v * V[2] + w * W[2],
      ]
    }
    const len = Math.hypot(n[0], n[1], n[2])
    const [x, y, z] = decodeKey(key)
    flatByCell.set(key, { nx: n[0] / len, ny: n[1] / len, nz: n[2] / len, cx: x + 0.5, cy: y + 0.5, cz: z + 0.5 })
  }

  const { grid, gx, gy, gz, min: occMin } = occ
  const dirs = hemisphereDirs()
  const nDirs = dirs.length
  const bs = blockScale(noiseScale)
  const gxgy = gx * gy
  const ox = occMin[0], oy = occMin[1], oz = occMin[2]

  for (const rect of atlas.rects) {
    const { normal, tangent1: t1, tangent2: t2 } = rect
    const nx = normal.x, ny = normal.y, nz = normal.z
    const t1x = t1.x, t1y = t1.y, t1z = t1.z
    const t2x = t2.x, t2y = t2.y, t2z = t2.z
    const depth = rect.depthCoord

    // Hemisphere directions in world space, once per rect: identical values to the old
    // per-texel transform (same inputs, same operation order), computed nDirs× per rect
    // instead of nDirs× per texel.
    const wdx = new Float64Array(nDirs)
    const wdy = new Float64Array(nDirs)
    const wdz = new Float64Array(nDirs)
    for (let i = 0; i < nDirs; i++) {
      const dt = dirs[i][0], dd = dirs[i][1], dt2 = dirs[i][2]
      wdx[i] = dd * nx + dt * t1x + dt2 * t2x
      wdy[i] = dd * ny + dt * t1y + dt2 * t2y
      wdz[i] = dd * nz + dt * t1z + dt2 * t2z
    }

    // Whole-rect early-out (see rectAheadIsEmpty): with no occluder ahead, every texel bakes
    // zero occlusion and the march is skipped. With noise on the texels still loop for the
    // grain — identical values, since a march with zero hits yields the same ao = 0.
    const hasInterior = rect.texWidth > PADDING * 2 && rect.texHeight > PADDING * 2
    const skipRays = hasInterior && rectAheadIsEmpty(grid, gx, gy, gz, ox, oy, oz, rect)

    for (let ty = PADDING; ty < rect.texHeight - PADDING; ty++) {
      for (let tx = PADDING; tx < rect.texWidth - PADDING; tx++) {
        const worldU = rect.minU + (tx - PADDING + 0.5) / TEXELS_PER_UNIT
        const worldV = rect.minV + (ty - PADDING + 0.5) / TEXELS_PER_UNIT

        const wx = nx * depth + t1x * worldU + t2x * worldV
        const wy = ny * depth + t1y * worldU + t2y * worldV
        const wz = nz * depth + t1z * worldU + t2z * worldV

        // Flat-quad texel: backing off along the rect normal lands in a flat cell, the texel
        // sits on that flat's quad plane, and the normals are parallel — bake constant white
        // (data is pre-filled 255) with no raycast. All three tests are needed: the cell test
        // alone would whitewash solid faces sitting exactly on a cell boundary next to a flat,
        // and the plane test alone would whitewash a solid face continuing the pane's plane.
        // Skipped entirely when the model has no flats (avoids a string key build per texel).
        if (flatByCell.size > 0) {
          const flat = flatByCell.get(encodeKey(Math.floor(wx - nx * 1e-3), Math.floor(wy - ny * 1e-3), Math.floor(wz - nz * 1e-3)))
          if (flat) {
            const parallel = Math.abs(nx * flat.nx + ny * flat.ny + nz * flat.nz)
            const planar = Math.abs((wx - flat.cx) * flat.nx + (wy - flat.cy) * flat.ny + (wz - flat.cz) * flat.nz)
            if (parallel > 0.999 && planar < 1e-3) continue
          }
        }

        // Grid cell of the surface texel (no nudge — exact surface position).
        const sx = Math.round((wx - ox) * TEXELS_PER_UNIT) - 1;
        const sy = Math.round((wy - oy) * TEXELS_PER_UNIT) - 1;
        const sz = Math.round((wz - oz) * TEXELS_PER_UNIT) - 1;

        let totalOcclusion = 0

        if (!skipRays) {
          for (let i = 0; i < nDirs; i++) {
            const dx = wdx[i], dy = wdy[i], dz = wdz[i]

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
              const ahead = (gx2 - sx) * nx + (gy2 - sy) * ny + (gz2 - sz) * nz
              if (ahead <= 0.5) continue

              if (grid[gx2 + gy2 * gx + gz2 * gxgy] === 1) {
                hitDistCells = step
                break
              }
            }

            if (hitDistCells < Infinity) {
              const hitDist = hitDistCells * CELL_SIZE
              totalOcclusion += 1 / (1.0 + hitDist)
            }
          }
        }

        const ao = totalOcclusion / nDirs
        const shaded = 1 - aoStrength * ao
        // Quantized grain: texels inside the same bs×bs block hash the same block indices, so
        // the grain reads as chunky cells rather than per-texel static (nearest, never blurred).
        const noiseVal = noiseLevel > 0
          ? hashNoise(
            Math.floor((wx * TEXELS_PER_UNIT) / bs),
            Math.floor((wy * TEXELS_PER_UNIT) / bs),
            Math.floor((wz * TEXELS_PER_UNIT) / bs),
            seed,
          )
          : 0
        const noised = Math.max(0, Math.min(1, shaded - noiseLevel * noiseVal))
        const value = Math.round(noised * 255)

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
    if (model.chamfer.has(key)) continue
    const [x, y, z] = decodeKey(key)
    const ix = x - min[0]; const iy = y - min[1]; const iz = z - min[2]
    data[ix + iy * wx + iz * wx * wy] = 255
  }
  // Subdivided parents occupy their cell (conservative — the volume is detail-solid).
  for (const key of model.subdiv.keys()) {
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
