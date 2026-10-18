import type { Coord } from '@/engine/grid/types'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { rectRegion } from './selectionMask'
import type { SelectionRegion } from '@/store/types'

/**
 * 3D marquee selection: the 3D-view counterpart of the 2D select tool's rect drag. Two grid
 * coords (drag start/end, already resolved onto the active construction plane) become a
 * plane-frame `SelectionRegion` via the shared `rectRegion` — identical corners yield a 1×1
 * tap selection. Everything downstream (copy/float/delete/highlight) consumes the region
 * exactly as if it had been drawn on the 2D canvas, because it is the same data.
 */
export function marqueeSelection(
  plane: ConstructionPlane,
  from: Coord,
  to: Coord,
): SelectionRegion {
  const a = pixelFromGridCoord(plane, from)
  const b = pixelFromGridCoord(plane, to)
  return rectRegion(a.u, a.v, b.u, b.v)
}
