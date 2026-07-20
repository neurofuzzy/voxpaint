import type { ChamferCell, ChamferClassification, Rotation } from '@/engine/grid/types'
import type { ClipboardData } from '@/store/types'

/**
 * Chamfer rotations are numbered in the plane's **logical** u/v frame (N = -v, E = +u, S = +v,
 * W = -u), with sides ordered N=0,E=1,S=2,W=3 and corners NE=0,SE=1,SW=2,NW=3 — the exact
 * convention chamferResolver.ts's `classify` assigns them in. Mirroring or rotating clipboard
 * content therefore has to renumber every resolved shape alongside its du/dv, or the cells land in
 * their new positions still bevelling the old way.
 *
 * `ramp` numbers its rotation off the OPEN side shifted by -1 (see `classify`), so it renumbers
 * through the side tables; `convex`, `concave` and `wedge` all number theirs directly off a corner
 * (wedge borrows convex's corner rotation — see paintActions.ts). `thin` is rotationally symmetric
 * and is always rotation 0.
 */
const SIDE_MIRROR_U: readonly Rotation[] = [0, 3, 2, 1] // E <-> W, N/S fixed
const SIDE_MIRROR_V: readonly Rotation[] = [2, 1, 0, 3] // N <-> S, E/W fixed
const CORNER_MIRROR_U: readonly Rotation[] = [3, 2, 1, 0] // NE <-> NW, SE <-> SW
const CORNER_MIRROR_V: readonly Rotation[] = [1, 0, 3, 2] // NE <-> SE, NW <-> SW

/** Renumbers a resolved shape for a mirror in logical u and/or v. See the tables above. */
export function mirrorClassification(c: ChamferClassification, mirrorU: boolean, mirrorV: boolean): ChamferClassification {
  if (c.shapeKind === 'thin' || (!mirrorU && !mirrorV)) return c

  if (c.shapeKind === 'ramp') {
    let open = ((c.rotation + 1) % 4) as Rotation
    if (mirrorU) open = SIDE_MIRROR_U[open]
    if (mirrorV) open = SIDE_MIRROR_V[open]
    return { shapeKind: c.shapeKind, rotation: ((open + 3) % 4) as Rotation }
  }

  let rotation = c.rotation
  if (mirrorU) rotation = CORNER_MIRROR_U[rotation]
  if (mirrorV) rotation = CORNER_MIRROR_V[rotation]
  return { shapeKind: c.shapeKind, rotation }
}

/**
 * Renumbers a resolved shape for a 90° turn in the logical u/v frame — matching the du/dv rotation
 * `rotateClipboard90` applies. Both orderings run clockwise (N->E->S->W and NE->SE->SW->NW), so
 * every rotatable kind is a plain ±1 step regardless of which table it uses.
 */
export function rotateClassification90(c: ChamferClassification, direction: 'cw' | 'ccw' = 'cw'): ChamferClassification {
  if (c.shapeKind === 'thin') return c
  return { shapeKind: c.shapeKind, rotation: ((c.rotation + (direction === 'cw' ? 1 : 3)) % 4) as Rotation }
}

function mapChamfer(chamfer: ChamferCell, map: (c: ChamferClassification) => ChamferClassification): ChamferCell {
  return {
    planeAxis: chamfer.planeAxis,
    planeOrientation: chamfer.planeOrientation,
    resolvedTo: chamfer.resolvedTo ? map(chamfer.resolvedTo) : null,
  }
}

/**
 * Rotates clipboard content 90° around its own bounding box (width/height swap).
 * `originU`/`originV` are deliberately dropped — they describe a box whose extents just swapped,
 * so transformed content tracks its position via `floatOrigin` instead (see ClipboardData).
 */
export function rotateClipboard90(clipboard: ClipboardData, direction: 'cw' | 'ccw' = 'cw'): ClipboardData {
  const { width, height } = clipboard
  const cw = direction === 'cw'
  return {
    width: height,
    height: width,
    copyPlaneAxis: clipboard.copyPlaneAxis,
    copyPlaneOrientation: clipboard.copyPlaneOrientation,
    cells: clipboard.cells.map((cell) => ({
      ...cell,
      du: cw ? height - 1 - cell.dv : cell.dv,
      dv: cw ? cell.du : width - 1 - cell.du,
      chamfer: cell.chamfer ? mapChamfer(cell.chamfer, (c) => rotateClassification90(c, direction)) : undefined,
    })),
  }
}

/** Mirrors clipboard content across its own bounding box. `originU`/`originV` dropped, as above. */
export function mirrorClipboard(clipboard: ClipboardData, axis: 'horizontal' | 'vertical'): ClipboardData {
  const { width, height } = clipboard
  const mirrorU = axis === 'horizontal'
  return {
    width,
    height,
    copyPlaneAxis: clipboard.copyPlaneAxis,
    copyPlaneOrientation: clipboard.copyPlaneOrientation,
    cells: clipboard.cells.map((cell) => ({
      ...cell,
      du: mirrorU ? width - 1 - cell.du : cell.du,
      dv: mirrorU ? cell.dv : height - 1 - cell.dv,
      chamfer: cell.chamfer ? mapChamfer(cell.chamfer, (c) => mirrorClassification(c, mirrorU, !mirrorU)) : undefined,
    })),
  }
}
