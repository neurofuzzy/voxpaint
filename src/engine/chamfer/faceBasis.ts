import type { Axis, ChamferCell, Orientation } from '@/engine/grid/types'
import { findDualRampRotation, findWedgeRampDual } from './rampDual'

/**
 * Re-authors one chamfer cell onto a new authoring basis so its box-mapped texture face
 * (`boxFaceForCell`, derived from `planeAxis`/`planeOrientation`) follows the new basis — the
 * selection-scale sibling of the single-cell texture-face tool (`rebaseRampCell`). The caller
 * mutates the cell in place (an Immer draft in practice) and runs inside one undo stroke.
 *
 * Geometry is never altered — this only switches which texture face a cell samples:
 * - ramp/wedge: exact-solid dual rebase (same rules as `rebaseRampCell` — a wedge source
 *   converts to its congruent ramp). False when inexpressible on the target basis, or when a
 *   ramp is already there (idempotent no-op).
 * - thin: same-axis orientation flips only. The centered slab is mirror-symmetric, so the solid
 *   is identical and only the sampled face switches. A cross-axis facing would rotate the slab
 *   (a geometry edit) and is refused.
 * - unresolved (`resolvedTo: null`): renders as a plain cube but still samples texture by its
 *   basis, so the basis is updated while the shape stays unresolved. Still a cube either way.
 * - convex/concave: no exact dual exists (see `rampDual.ts`) and re-basing would alter the
 *   solid — always false, left untouched.
 */
export function rebaseChamferCell(cell: ChamferCell, targetAxis: Axis, targetOrientation: Orientation): boolean {
  const kind = cell.resolvedTo?.shapeKind
  if (kind === 'ramp') {
    const rotation = findDualRampRotation(cell, targetAxis, targetOrientation)
    if (rotation === null) return false
    if (rotation === cell.resolvedTo!.rotation && cell.planeAxis === targetAxis && cell.planeOrientation === targetOrientation) {
      return false
    }
    cell.planeAxis = targetAxis
    cell.planeOrientation = targetOrientation
    cell.resolvedTo = { shapeKind: 'ramp', rotation }
    return true
  }
  if (kind === 'wedge') {
    const rotation = findWedgeRampDual(cell, targetAxis, targetOrientation)
    if (rotation === null) return false
    cell.planeAxis = targetAxis
    cell.planeOrientation = targetOrientation
    cell.resolvedTo = { shapeKind: 'ramp', rotation }
    return true
  }
  if (kind === 'thin') {
    if (cell.planeAxis !== targetAxis) return false
    if (cell.planeOrientation === targetOrientation) return false
    cell.planeOrientation = targetOrientation
    return true
  }
  if (cell.resolvedTo === null) {
    if (cell.planeAxis === targetAxis && cell.planeOrientation === targetOrientation) return false
    cell.planeAxis = targetAxis
    cell.planeOrientation = targetOrientation
    return true
  }
  return false
}
