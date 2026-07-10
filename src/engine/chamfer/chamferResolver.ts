import type { VoxelModel } from '@/engine/grid/types'
import { encodeKey } from '@/engine/grid/GridStore'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { ChamferClassification, NeighborSample } from './types'

/**
 * Samples the chamfer layer's 8-neighborhood around a (u,v) pixel on the active plane.
 * Excludes the target cell itself (it isn't painted yet when validating a hover/paint).
 */
export function sampleNeighbors(model: VoxelModel, plane: ConstructionPlane, u: number, v: number): NeighborSample {
  const has = (du: number, dv: number) => {
    const coord = gridCoordFromPixel(plane, u + du, v + dv)
    return model.chamfer.has(encodeKey(...coord))
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
 * Returns null when the configuration is invalid — callers must not paint there.
 */
export function classify(n: NeighborSample): ChamferClassification | null {
  const sides = [n.N, n.E, n.S, n.W]
  const orthoCount = sides.filter(Boolean).length

  if (orthoCount === 3) {
    const openIndex = sides.indexOf(false) as 0 | 1 | 2 | 3
    return { shapeKind: 'ramp', rotation: openIndex }
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

  return null // 0 or 1 orthogonal neighbors — not a defined shape
}

/** Live validation used to gate the paint cursor/brush per spec §3.3. */
export function canPaintChamfer(model: VoxelModel, plane: ConstructionPlane, u: number, v: number): boolean {
  return classify(sampleNeighbors(model, plane, u, v)) !== null
}
