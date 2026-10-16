import type { Coord, GridExtent, Orientation, Rotation, VoxelModel } from '@/engine/grid/types'
import { decodeKey, effectiveExtent, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { outwardNormal } from '@/engine/plane/planeGeometry'

/**
 * 2x project rescale: every voxel becomes a 2×2×2 block of the doubled model, about the grid
 * origin (old cell `c` spans new cells `2c, 2c+1` — same world cell size, twice as many cells).
 *
 * Bevels decompose exactly: every chamfer solid's boundaries pass through half-lattice points,
 * so sampling each child's 8 corners (also half-lattice) against the shape's exact inequalities
 * is exact — no epsilons, no clipping code. The sampled corner pattern is matched against the
 * canonical patterns of the known shapes, so children land as cubes/ramps/wedges/corners with
 * rotations in the parent's own logical frame (the authoring basis is preserved verbatim —
 * rescale never re-resolves anything). This is sound because a parent shape plane restricted to
 * a child box coincides with the canonical plane of the matched shape: every plane passes
 * through the child's lattice points, so restriction and canonical form agree (volume
 * conservation per kind × rotation in rescale.test.ts guards this).
 *
 * Children reduced to an edge or less (zero volume — e.g. concave's far-corner child) match
 * nothing and are left empty, which is exact. Two shapes need direct rules instead of sampling:
 * - `thin` (centered slab, quarter-lattice boundaries the sampler can't see): 8 flush `half`
 *   slabs — 4 back-to-back columns, lower layer oriented +1, upper −1.
 * - `half` (flush slab): sampling would hallucinate phantom slabs on zero-volume boundary
 *   hits, so it maps directly to 4 full cubes in the slab's layer.
 */

/** Rescale factor: 2x along every axis (1 voxel → 8). */
export const RESCALE_FACTOR = 2 as const

/**
 * Grid extent after a 2x rescale. Doubles the even working grid (odd sizes round up first via
 * `effectiveExtent`), so every old cell maps exactly onto 2×2×2 new cells with nothing clipped.
 * May exceed `MAX_GRID_EXTENT` — callers disable the menu entry when it does.
 */
export function rescaleTargetExtent(extent: GridExtent): GridExtent {
  return RESCALE_FACTOR * effectiveExtent(extent)
}

/** The two child coordinates grown from old coordinate `c` (about the origin). */
export function rescaleCoord(c: number): [number, number] {
  return [RESCALE_FACTOR * c, RESCALE_FACTOR * c + 1]
}

type BevelKind = 'ramp' | 'wedge' | 'concave' | 'convex'

/**
 * Inverse in-plane quarter-turn R^-r on logical (u, v): shape rotation renumbers exactly like the
 * baked geometry rotation (r=1 turns an east opening south — pinned by rescale tests against the
 * geometry + resolver conventions: ramp opens east at r=0; wedge/convex/concave cut/open the NE
 * corner at r=0).
 */
function unrotate(u: number, v: number, rotation: Rotation): [number, number] {
  switch (rotation) {
    case 0: return [u, v]
    case 1: return [v, 1 - u]
    case 2: return [1 - u, 1 - v]
    case 3: return [1 - v, u]
  }
}

/**
 * Exact solid membership in the canonical (rotation-0) logical frame, old cell = [0,1]^3.
 * Conventions verified against chamferTransform's prefab corner sets (all inside-corners agree).
 */
function insideCanonical(kind: BevelKind, u: number, v: number, w: number, rotation: Rotation): boolean {
  const [cu, cv] = unrotate(u, v, rotation)
  switch (kind) {
    case 'ramp': return w <= 1 - cu
    case 'wedge': return cu <= cv
    case 'convex': return w <= cv && cu + w <= 1
    case 'concave': return w <= cv || cu + w <= 1
  }
}

type ChildOutcome = { kind: 'cube' } | { kind: BevelKind; rotation: Rotation } | null

const CANDIDATES: Array<{ kind: BevelKind; rotation: Rotation }> = (['ramp', 'wedge', 'convex', 'concave'] as const).flatMap(
  (kind) => ([0, 1, 2, 3] as const).map((rotation) => ({ kind, rotation })),
)

/** Inside-pattern of the 8 unit-box corners (index a+2b+4c) for a candidate solid. */
function canonicalPattern(kind: BevelKind, rotation: Rotation): boolean[] {
  const pattern: boolean[] = []
  for (let c = 0; c < 2; c++) {
    for (let b = 0; b < 2; b++) {
      for (let a = 0; a < 2; a++) {
        pattern.push(insideCanonical(kind, a, b, c, rotation))
      }
    }
  }
  return pattern
}

const CANONICAL_PATTERNS: Array<{ kind: BevelKind; rotation: Rotation; pattern: boolean[] }> = CANDIDATES.map(
  ({ kind, rotation }) => ({ kind, rotation, pattern: canonicalPattern(kind, rotation) }),
)

/** Matches a sampled child corner pattern to a solid: full box, empty, or a known shape. Null
 * (empty) is also the documented concave-apex-tetrahedron approximation — see module doc. */
function matchChild(pattern: boolean[]): ChildOutcome {
  if (pattern.every(Boolean)) return { kind: 'cube' }
  if (pattern.every((inside) => !inside)) return null
  const key = pattern.map((inside) => (inside ? '1' : '0')).join('')
  for (const candidate of CANONICAL_PATTERNS) {
    if (candidate.pattern.map((inside) => (inside ? '1' : '0')).join('') === key) {
      return { kind: candidate.kind, rotation: candidate.rotation }
    }
  }
  return null
}

/** Logical-frame (du, dv, dw) unit offsets of the 8 children. */
const CHILD_OFFSETS: Array<[number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
]

/** World-space child coordinate. Logical child (du, dv, dw) tiles the doubled cell, but a
 * logical axis running toward −world (e.g. the z-plane's v, which is world −y) must flip its
 * sub-index (1−d): children always tile world cells [2c, 2c+1], so neighboring old cells can
 * never collide. Shape assignment stays in the logical frame — only placement flips. */
function childCoord(
  base: Coord,
  du: number, dv: number, dw: number,
  U: Coord, V: Coord, W: Coord,
): Coord {
  const ds = [du, dv, dw]
  const dirs = [U, V, W]
  const out: Coord = [0, 0, 0]
  for (let j = 0; j < 3; j++) {
    // U/V/W are signed unit axes spanning all three world axes exactly once.
    const k = dirs.findIndex((D) => D[j] !== 0)
    out[j] = RESCALE_FACTOR * base[j] + (dirs[k][j] > 0 ? ds[k] : 1 - ds[k])
  }
  return out
}

/**
 * Doubles the voxel model: every cell becomes its exact 2×2×2 block (see module doc). Color
 * slots carry over by reference; chamfer bases are preserved verbatim and shapes are never
 * re-resolved. Returns a fresh model with recomputed bounds.
 */
export function rescaleVoxelModel(model: VoxelModel): VoxelModel {
  const color: VoxelModel['color'] = new Map()
  const chamfer: VoxelModel['chamfer'] = new Map()

  for (const [key, colorCell] of model.color) {
    const base = decodeKey(key)
    const chamferCell = model.chamfer.get(key)
    const resolved = chamferCell?.resolvedTo
    const shapeKind = resolved?.shapeKind ?? null

    if (!chamferCell || !resolved) {
      // Plain cube, or an unresolved chamfer (renders as a cube): 8 verbatim children.
      for (const [du, dv, dw] of CHILD_OFFSETS) {
        const coord: Coord = [RESCALE_FACTOR * base[0] + du, RESCALE_FACTOR * base[1] + dv, RESCALE_FACTOR * base[2] + dw]
        const childKey = encodeKey(...coord)
        color.set(childKey, { paletteSlot: colorCell.paletteSlot })
        if (chamferCell) {
          chamfer.set(childKey, {
            planeAxis: chamferCell.planeAxis,
            planeOrientation: chamferCell.planeOrientation,
            resolvedTo: null,
          })
        }
      }
      continue
    }

    const { uDir: U, vDir: V } = planeLogicalBasis(chamferCell.planeAxis)
    const W = outwardNormal(chamferCell.planeAxis, chamferCell.planeOrientation)

    if (shapeKind === 'thin') {
      // Centered slab straddles the new layer boundary: 4 back-to-back half columns.
      for (const [du, dv, dw] of CHILD_OFFSETS) {
        const coord = childCoord(base, du, dv, dw, U, V, W)
        const childKey = encodeKey(...coord)
        color.set(childKey, { paletteSlot: colorCell.paletteSlot })
        chamfer.set(childKey, {
          planeAxis: chamferCell.planeAxis,
          planeOrientation: (dw === 0 ? 1 : -1) as Orientation,
          resolvedTo: { shapeKind: 'half', rotation: 0 },
        })
      }
      continue
    }

    if (shapeKind === 'half') {
      // Flush slab exactly fills one new layer: 4 full cubes, no chamfer entries.
      const layer = chamferCell.planeOrientation === 1 ? 1 : 0
      for (const [du, dv, dw] of CHILD_OFFSETS) {
        if (dw !== layer) continue
        const coord = childCoord(base, du, dv, dw, U, V, W)
        color.set(encodeKey(...coord), { paletteSlot: colorCell.paletteSlot })
      }
      continue
    }

    // Bevels: sample each child's corners against the exact solid, match to a solid.
    for (const [du, dv, dw] of CHILD_OFFSETS) {
      const pattern: boolean[] = []
      for (let c = 0; c < 2; c++) {
        for (let b = 0; b < 2; b++) {
          for (let a = 0; a < 2; a++) {
            pattern.push(
              insideCanonical(shapeKind as BevelKind, (du + a) / 2, (dv + b) / 2, (dw + c) / 2, resolved.rotation),
            )
          }
        }
      }
      const outcome = matchChild(pattern)
      if (!outcome) continue
      const coord = childCoord(base, du, dv, dw, U, V, W)
      const childKey = encodeKey(...coord)
      color.set(childKey, { paletteSlot: colorCell.paletteSlot })
      if (outcome.kind !== 'cube') {
        chamfer.set(childKey, {
          planeAxis: chamferCell.planeAxis,
          planeOrientation: chamferCell.planeOrientation,
          resolvedTo: { shapeKind: outcome.kind, rotation: outcome.rotation },
        })
      }
    }
  }

  const next: VoxelModel = { color, chamfer, bounds: null }
  next.bounds = recomputeBounds(next)
  return next
}
