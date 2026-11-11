import type { Axis, ChamferClassification, Rotation, SubdivCell } from '@/engine/grid/types'
import { mirrorSubdivChildren, rotateSubdivChildren } from '@/engine/grid/subdiv'
import { mirrorChamferCell, rotateChamferCell } from '@/engine/chamfer/chamferTransform'
import type { ClipboardCell, ClipboardData, FineSelection } from '@/store/types'

/**
 * Chamfer rotations are numbered in the plane's **logical** u/v frame (N = -v, E = +u, S = +v,
 * W = -u), with sides ordered N=0,E=1,S=2,W=3 and corners NE=0,SE=1,SW=2,NW=3 — the exact
 * convention chamferResolver.ts's `classify` assigns them in. Mirroring or rotating clipboard
 * content therefore has to renumber every resolved shape alongside its du/dv, or the cells land in
 * their new positions still bevelling the old way.
 *
 * `ramp` numbers its rotation off the OPEN side shifted by -1 (see `classify`), so it renumbers
 * through the side tables; `convex`, `concave`, `wedge`, `quarter`, and `flatwedge` all number
 * theirs directly off a corner (`quarter`'s is the *occupied* corner, `flatwedge`'s the *open*
 * corner like the wedge; wedge borrows convex's corner rotation — see paintActions.ts). `thin`,
 * `half`, `post`, and `flat` are invariant under in-plane rotation/mirror (always rotation 0)
 * and pass through untouched.
 */
const SIDE_MIRROR_U: readonly Rotation[] = [0, 3, 2, 1] // E <-> W, N/S fixed
const SIDE_MIRROR_V: readonly Rotation[] = [2, 1, 0, 3] // N <-> S, E/W fixed
const CORNER_MIRROR_U: readonly Rotation[] = [3, 2, 1, 0] // NE <-> NW, SE <-> SW
const CORNER_MIRROR_V: readonly Rotation[] = [1, 0, 3, 2] // NE <-> SE, NW <-> SW

/** Renumbers a resolved shape for a mirror in logical u and/or v. See the tables above. */
export function mirrorClassification(c: ChamferClassification, mirrorU: boolean, mirrorV: boolean): ChamferClassification {
  if (c.shapeKind === 'thin' || c.shapeKind === 'half' || c.shapeKind === 'post' || c.shapeKind === 'flat' || (!mirrorU && !mirrorV)) return c

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
  if (c.shapeKind === 'thin' || c.shapeKind === 'half' || c.shapeKind === 'post' || c.shapeKind === 'flat') return c
  return { shapeKind: c.shapeKind, rotation: ((c.rotation + (direction === 'cw' ? 1 : 3)) % 4) as Rotation }
}

/**
 * The plane a float's du/dv live in: the recorded source plane (kept current by
 * `transformClipboardToPlane` on every paste), falling back to the cell's own axis for sourceless
 * content — which reduces to the legacy in-frame renumber for that cell.
 */
function rotationPlaneFor(clipboard: ClipboardData, cell: ClipboardCell): Axis {
  return clipboard.copyPlaneAxis ?? cell.chamfer?.planeAxis ?? 'z'
}

/**
 * Rotates one subdivided entry 90° in the given plane's logical (u,v) frame: children
 * permute to their rotated positions (the split axes can exchange, as documented on
 * `rotateSubdivChildren`) and every beveled child's frozen shape renumbers through the
 * same rigid motion unit voxels use (`rotateChamferCell`), so the detail turns with its
 * parent instead of bevelling the old way. Returns a fresh entry (slot refs shared —
 * slots are immutable values); the scaffold flag rides along.
 */
export function rotateSubdivEntry(
  sub: SubdivCell,
  planeAxis: Axis,
  direction: 'cw' | 'ccw' = 'cw',
): SubdivCell {
  const rotated = rotateSubdivChildren(sub.children, sub.split, planeAxis, direction)
  return {
    slot: sub.slot,
    split: rotated.split,
    ...(sub.scaffold ? { scaffold: true as const } : {}),
    children: rotated.children.map((child) =>
      child?.chamfer ? { slot: child.slot, chamfer: rotateChamferCell(child.chamfer, planeAxis, direction) } : child,
    ),
  }
}

/**
 * Mirrors one subdivided entry in the given plane's logical (u,v) frame — the same
 * contract as `rotateSubdivEntry`: children permute via `mirrorSubdivChildren`, beveled
 * children renumber via `mirrorChamferCell`, slot and scaffold preserved.
 */
export function mirrorSubdivEntry(
  sub: SubdivCell,
  planeAxis: Axis,
  mirrorU: boolean,
  mirrorV: boolean,
): SubdivCell {
  return {
    slot: sub.slot,
    split: [...sub.split],
    ...(sub.scaffold ? { scaffold: true as const } : {}),
    children: mirrorSubdivChildren(sub.children, sub.split, planeAxis, mirrorU, mirrorV).map((child) =>
      child?.chamfer ? { slot: child.slot, chamfer: mirrorChamferCell(child.chamfer, planeAxis, mirrorU, mirrorV) } : child,
    ),
  }
}

/** Rotates a sub-voxel footprint 90° with its content: fine extents swap, so su and sv do too. */
function rotateFineFootprint(fine: FineSelection, width: number, height: number, direction: 'cw' | 'ccw'): FineSelection {
  const fw = width * fine.su
  const fh = height * fine.sv
  const out = new Uint8Array(fw * fh)
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (fine.mask[y * fw + x] !== 1) continue
      const nx = direction === 'cw' ? fh - 1 - y : y
      const ny = direction === 'cw' ? x : fw - 1 - x
      out[ny * fh + nx] = 1
    }
  }
  return { su: fine.sv, sv: fine.su, slab: fine.slab, mask: out }
}

/** Mirrors a sub-voxel footprint across the frame (horizontal = in u, vertical = in v). */
function mirrorFineFootprint(fine: FineSelection, width: number, height: number, axis: 'horizontal' | 'vertical'): FineSelection {
  const fw = width * fine.su
  const fh = height * fine.sv
  const out = new Uint8Array(fw * fh)
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (fine.mask[y * fw + x] !== 1) continue
      out[(axis === 'vertical' ? fh - 1 - y : y) * fw + (axis === 'horizontal' ? fw - 1 - x : x)] = 1
    }
  }
  return { su: fine.su, sv: fine.sv, slab: fine.slab, mask: out }
}

/**
 * Rotates clipboard content 90° around its own bounding box (width/height swap).
 * `originU`/`originV` are deliberately dropped — they describe a box whose extents just swapped,
 * so transformed content tracks its position via `floatOrigin` instead (see ClipboardData).
 *
 * Chamfers map through their exact rotated solid (`rotateChamferCell`): same-plane bevels
 * renumber in place, while bevels baked on another axis re-base onto whichever axis their solid
 * turns into.
 */
export function rotateClipboard90(clipboard: ClipboardData, direction: 'cw' | 'ccw' = 'cw'): ClipboardData {
  const { width, height } = clipboard
  const cw = direction === 'cw'
  return {
    width: height,
    height: width,
    copyPlaneAxis: clipboard.copyPlaneAxis,
    copyPlaneOrientation: clipboard.copyPlaneOrientation,
    ...(clipboard.fine ? { fine: rotateFineFootprint(clipboard.fine, width, height, direction) } : {}),
    cells: clipboard.cells.map((cell) => {
      const planeAxis = rotationPlaneFor(clipboard, cell)
      const rotated = cell.subdiv ? rotateSubdivEntry(cell.subdiv, planeAxis, direction) : undefined
      return {
        ...cell,
        du: cw ? height - 1 - cell.dv : cell.dv,
        dv: cw ? cell.du : width - 1 - cell.du,
        chamfer: cell.chamfer ? rotateChamferCell(cell.chamfer, planeAxis, direction) : undefined,
        // Detail rotates in the same logical frame as the du/dv rotation above; the split
        // axes can exchange (a u-split turned on its side is a v-split) and beveled
        // children renumber with it — see `rotateSubdivEntry`.
        subdiv: rotated,
      }
    }),
  }
}

/**
 * Mirrors clipboard content across its own bounding box. `originU`/`originV` dropped, as above.
 * Chamfers map through their exact mirrored solid (`mirrorChamferCell`) — see rotateClipboard90.
 */
export function mirrorClipboard(clipboard: ClipboardData, axis: 'horizontal' | 'vertical'): ClipboardData {
  const { width, height } = clipboard
  const mirrorU = axis === 'horizontal'
  return {
    width,
    height,
    copyPlaneAxis: clipboard.copyPlaneAxis,
    copyPlaneOrientation: clipboard.copyPlaneOrientation,
    ...(clipboard.fine ? { fine: mirrorFineFootprint(clipboard.fine, width, height, axis) } : {}),
    cells: clipboard.cells.map((cell) => {
      const planeAxis = rotationPlaneFor(clipboard, cell)
      return {
        ...cell,
        du: mirrorU ? width - 1 - cell.du : cell.du,
        dv: mirrorU ? cell.dv : height - 1 - cell.dv,
        chamfer: cell.chamfer ? mirrorChamferCell(cell.chamfer, planeAxis, mirrorU, !mirrorU) : undefined,
        subdiv: cell.subdiv ? mirrorSubdivEntry(cell.subdiv, planeAxis, mirrorU, !mirrorU) : undefined,
      }
    }),
  }
}
