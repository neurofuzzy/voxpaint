import type { ChamferCell, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { forEachSelectedCell } from './selectionMask'
import { mirrorClassification } from './transform'
import type { ClipboardCell, ClipboardData, SelectionRegion } from '@/store/types'

/** Deep-copy a chamfer cell so the clipboard never shares references with the live model. */
function cloneChamfer(c: ChamferCell): ChamferCell {
  return { planeAxis: c.planeAxis, planeOrientation: c.planeOrientation, resolvedTo: c.resolvedTo ? { ...c.resolvedTo } : null }
}

/**
 * Snapshots a selection off the active plane. The source plane is recorded alongside the cells so
 * a later paste onto a different plane can re-express the content there — see
 * `transformClipboardToPlane`.
 */
export function copyRegionToClipboard(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion): ClipboardData {
  const cells: ClipboardCell[] = []
  forEachSelectedCell(region, (u, v) => {
    const key = encodeKey(...gridCoordFromPixel(plane, u, v))
    const color = model.color.get(key)
    const chamfer = model.chamfer.get(key)
    if (!color && !chamfer) return
    cells.push({
      du: u - region.originU,
      dv: v - region.originV,
      color: color ? { paletteSlot: color.paletteSlot } : undefined,
      chamfer: chamfer ? cloneChamfer(chamfer) : undefined,
    })
  })
  return { width: region.width, height: region.height, originU: region.originU, originV: region.originV, cells, copyPlaneAxis: plane.axis, copyPlaneOrientation: plane.orientation }
}

/** Erases both layers under a selection mask (used by cut/move). Mutates the given (draft) model. */
export function clearRegion(model: VoxelModel, plane: ConstructionPlane, region: SelectionRegion): void {
  forEachSelectedCell(region, (u, v) => {
    const key = encodeKey(...gridCoordFromPixel(plane, u, v))
    model.color.delete(key)
    model.chamfer.delete(key)
  })
}

/**
 * Stamps clipboard data at a destination origin. Chamfer cells are restored **verbatim** — their
 * copied plane basis and resolved shape are written back unchanged, with no reclassification against
 * the destination's neighbors, so the pasted result exactly matches the source. (A chamfer only ever
 * (re)resolves when the user edits that specific voxel.) Mutates the given (draft) model directly.
 */
export function applyClipboardAt(
  model: VoxelModel,
  plane: ConstructionPlane,
  clipboard: ClipboardData,
  destOriginU: number,
  destOriginV: number,
  gridExtent: GridExtent,
): void {
  for (const cell of clipboard.cells) {
    const coord = gridCoordFromPixel(plane, destOriginU + cell.du, destOriginV + cell.dv)
    if (!withinWorkingBounds(coord, gridExtent)) continue

    const key = encodeKey(...coord)

    if (cell.chamfer) model.chamfer.set(key, cloneChamfer(cell.chamfer))
    else model.chamfer.delete(key)

    if (cell.color) {
      model.color.set(key, { paletteSlot: cell.color.paletteSlot })
      model.bounds = expandBounds(model.bounds, coord)
    }
  }
}

/**
 * Whether the 2D canvas mirrors this plane's logical u (resp. v) when drawing it. Probed through
 * `toDisplayU`/`toDisplayV` rather than restating their (empirically determined, per-axis) rules,
 * so this can't drift out of sync with them: both are `n -> -n - 1` when they flip, so cell 0 maps
 * to -1 exactly when the axis is mirrored.
 */
function mirrorsU(plane: ConstructionPlane): boolean {
  return toDisplayU(plane, 0) !== 0
}

function mirrorsV(plane: ConstructionPlane): boolean {
  return toDisplayV(plane, 0) !== 0
}

/**
 * Rebases a chamfer onto the destination plane, preserving how it reads on screen.
 *
 * Only chamfers baked on the plane the copy was actually taken from get rebased: those are the
 * ones whose bevel lies in the copied view and therefore has a 2D appearance to preserve. A
 * chamfer baked on some *other* plane (painted earlier from a different angle, and merely visible
 * in this slice) bevels out of the copied view entirely — there's no screen orientation to carry
 * over — so it rides along verbatim, per the usual "chamfers only ever re-resolve when the user
 * edits that specific voxel" rule.
 */
function rebaseChamfer(
  chamfer: ChamferCell,
  fromPlane: ConstructionPlane,
  toPlane: ConstructionPlane,
  mirrorU: boolean,
  mirrorV: boolean,
): ChamferCell {
  if (chamfer.planeAxis !== fromPlane.axis || chamfer.planeOrientation !== fromPlane.orientation) return chamfer
  return {
    planeAxis: toPlane.axis,
    planeOrientation: toPlane.orientation,
    resolvedTo: chamfer.resolvedTo ? mirrorClassification(chamfer.resolvedTo, mirrorU, mirrorV) : null,
  }
}

/** Re-expresses the copied region's top-left in the destination plane's logical frame by routing it
 * through screen space, so paste-in-place lands on the same on-screen spot it was copied from. */
function rebaseOrigin(
  clipboard: ClipboardData,
  fromPlane: ConstructionPlane,
  toPlane: ConstructionPlane,
): { originU: number; originV: number } | undefined {
  const { originU, originV, width, height } = clipboard
  if (originU == null || originV == null) return undefined

  // `toDisplayU`/`toDisplayV` are involutory, so the same call converts logical -> screen on the
  // source plane and screen -> logical on the destination. A mirrored axis reverses the span, so
  // take the min of both corners rather than assuming which end is the top-left.
  const screenU = Math.min(toDisplayU(fromPlane, originU), toDisplayU(fromPlane, originU + width - 1))
  const screenV = Math.min(toDisplayV(fromPlane, originV), toDisplayV(fromPlane, originV + height - 1))
  return {
    originU: Math.min(toDisplayU(toPlane, screenU), toDisplayU(toPlane, screenU + width - 1)),
    originV: Math.min(toDisplayV(toPlane, screenV), toDisplayV(toPlane, screenV + height - 1)),
  }
}

/**
 * Re-expresses clipboard content copied off one construction plane so that pasting it onto
 * `toPlane` reproduces the same picture the user saw when they copied — cells in the same
 * screen-relative arrangement, chamfers bevelling the same screen-relative way but now out of the
 * destination plane's face instead of the source plane's.
 *
 * Clipboard du/dv and chamfer rotations are both stored in the source plane's *logical* frame,
 * while what the user sees is *screen* space (logical, plus the per-plane mirror in
 * planeDisplay.ts). So the whole transform is the difference between the two planes' mirrors: a
 * flip in u and/or v, applied to positions and resolved shapes alike. Note that this is often
 * empty across a pure axis change (+Z -> +X mirrors neither), which is the point — the content
 * stays put on screen and only the chamfers' baked plane moves.
 *
 * Returns the input untouched for content with no recorded source plane (transformed float
 * content) or when the destination is the plane it was copied from.
 */
export function transformClipboardToPlane(clipboard: ClipboardData, toPlane: ConstructionPlane): ClipboardData {
  const { copyPlaneAxis, copyPlaneOrientation, width, height } = clipboard
  if (!copyPlaneAxis || copyPlaneOrientation == null) return clipboard
  if (copyPlaneAxis === toPlane.axis && copyPlaneOrientation === toPlane.orientation) return clipboard

  const fromPlane: ConstructionPlane = { axis: copyPlaneAxis, orientation: copyPlaneOrientation, offset: 0 }
  const mirrorU = mirrorsU(fromPlane) !== mirrorsU(toPlane)
  const mirrorV = mirrorsV(fromPlane) !== mirrorsV(toPlane)

  return {
    ...clipboard,
    ...rebaseOrigin(clipboard, fromPlane, toPlane),
    copyPlaneAxis: toPlane.axis,
    copyPlaneOrientation: toPlane.orientation,
    cells: clipboard.cells.map((cell) => ({
      ...cell,
      du: mirrorU ? width - 1 - cell.du : cell.du,
      dv: mirrorV ? height - 1 - cell.dv : cell.dv,
      chamfer: cell.chamfer ? rebaseChamfer(cell.chamfer, fromPlane, toPlane, mirrorU, mirrorV) : undefined,
    })),
  }
}
