import type { ChamferClassification, VoxelModel } from '@/engine/grid/types'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { NeighborSample } from './types'

/**
 * Samples the 8-neighborhood around a (u,v) pixel on the active plane. A neighbor counts as
 * "filled" if it's occupied at all — a plain color cube or a chamfer cell (resolved or not)
 * both count — since a chamfer bevels the edge of whatever solid volume is there, not
 * specifically the edge of *other chamfer cells*. This lets a solid block get chamfered around
 * its outer cells immediately (every neighbor already exists), instead of requiring the whole
 * chamfer layer to somehow bootstrap itself from nothing. Excludes the target cell itself (it
 * isn't painted yet when validating a hover/paint).
 */
export function sampleNeighbors(model: VoxelModel, plane: ConstructionPlane, u: number, v: number): NeighborSample {
  const has = (du: number, dv: number) => {
    const coord = gridCoordFromPixel(plane, u + du, v + dv)
    return model.color.has(encodeKey(...coord))
  }
  return {
    N: has(0, -1),
    S: has(0, 1),
    E: has(1, 0),
    W: has(-1, 0),
    NE: has(1, -1),
    NW: has(-1, -1),
    SE: has(1, 1),
    SW: has(-1, 1),
  }
}

// Side order: N=0, E=1, S=2, W=3 (clockwise from north).
// Corner order: NE=0, SE=1, SW=2, NW=3 (clockwise from north-east) — shared rotation
// convention between convex (open corner) and concave (notched corner) shapes.

/** filled-side-pair -> the open corner between the two OPEN (unfilled) sides. */
const ADJACENT_FILLED_TO_OPEN_CORNER: Record<string, 0 | 1 | 2 | 3> = {
  '0,1': 2, // filled N,E -> open S,W -> corner SW
  '1,2': 3, // filled E,S -> open W,N -> corner NW
  '2,3': 0, // filled S,W -> open N,E -> corner NE
  '0,3': 1, // filled W,N -> open E,S -> corner SE
}

/**
 * Classifies a chamfer cell's shape from its 8-neighborhood, per spec §1.3.
 * Returns null when the configuration doesn't (yet) resolve to a defined shape — callers store
 * that as `resolvedTo: null` rather than blocking the paint (see paintActions.ts).
 */
export function classify(n: NeighborSample): ChamferClassification | null {
  const sides = [n.N, n.E, n.S, n.W]
  const orthoCount = sides.filter(Boolean).length

  if (orthoCount === 3) {
    const openIndex = sides.indexOf(false)
    // The ramp mesh's rotation 0 slopes toward E, not N — so rotation is the open side's index
    // shifted by -1 (mod 4), not the raw index. Verified against etc/chamfer-tests.md's worked
    // example: N-open->3, E-open->0, W-open->2 (all three appear unambiguously in that test's
    // outer ring), and S-open->1 follows by elimination (a proper 4-way rotation must use each
    // of 0-3 exactly once across the 4 possible open sides).
    const rotation = ((openIndex + 3) % 4) as 0 | 1 | 2 | 3
    return { shapeKind: 'ramp', rotation }
  }

  if (orthoCount === 2) {
    const filledIndices = sides.reduce<number[]>((acc, filled, i) => (filled ? [...acc, i] : acc), [])
    const key = filledIndices.join(',')
    const cornerRotation = ADJACENT_FILLED_TO_OPEN_CORNER[key]
    if (cornerRotation === undefined) return null // opposite sides filled (N,S or E,W) — not a defined shape
    return { shapeKind: 'convex', rotation: cornerRotation }
  }

  if (orthoCount === 4) {
    const diagonals = [n.NE, n.SE, n.SW, n.NW]
    const emptyDiagonalIndices = diagonals.reduce<number[]>((acc, filled, i) => (filled ? acc : [...acc, i]), [])
    if (emptyDiagonalIndices.length !== 1) return null
    return { shapeKind: 'concave', rotation: emptyDiagonalIndices[0] as 0 | 1 | 2 | 3 }
  }

  return null // 0 or 1 orthogonal neighbors — not a defined shape (e.g. the very first chamfer
  // cell painted in an area — stays unresolved until enough neighbors join it)
}

/**
 * Re-attempts resolution for every still-unresolved (`resolvedTo: null`) chamfer cell that lives
 * on the given plane's exact (axis, offset) slice — the only cells whose neighbor context an edit
 * on this plane could possibly have changed. Once resolved, a cell's shape is frozen forever, so
 * this only ever moves `resolvedTo` from null to non-null, never re-resolves an already-resolved
 * cell (matching the old "frozen at paint time" rule, just deferred to whenever it first becomes
 * resolvable instead of blocking the paint that couldn't yet resolve it). Mutates the given
 * (draft) model. Cheap to call after every chamfer paint — it only scans one plane's worth of
 * already-chamfered cells, not the whole model.
 */
export function resolveChamferCellsOnPlane(model: VoxelModel, plane: ConstructionPlane): void {
  const i = axisIndex(plane.axis)
  for (const [key, cell] of model.chamfer) {
    if (cell.resolvedTo || cell.planeAxis !== plane.axis) continue
    const coord = decodeKey(key)
    if (coord[i] !== plane.offset) continue
    const { u, v } = pixelFromGridCoord(plane, coord)
    const resolvedTo = classify(sampleNeighbors(model, plane, u, v))
    if (resolvedTo) cell.resolvedTo = resolvedTo
  }
}
