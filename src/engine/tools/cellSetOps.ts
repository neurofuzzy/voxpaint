import { decodeKey, encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { CellKey, ChamferCell, Coord, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import { mirrorChamferCell, rotateChamferCell } from '@/engine/chamfer/chamferTransform'
import { cloneChamfer } from './clipboard'
import type { ClipboardCell, ClipboardData, SelectionRegion, SelectionTransformKind } from '@/store/types'

/** One live voxel snapshot: absolute coord plus both layers (chamfer deep-copied). */
export type CellSnapshot = {
  coord: Coord
  paletteSlot: PaletteSlotRef
  chamfer: ChamferCell | undefined
}

/** Axis-aligned bounding box of grid coords, or null when empty. */
export function bboxOfCoords(coords: Coord[]): { min: Coord; max: Coord } | null {
  if (coords.length === 0) return null
  const min: Coord = [...coords[0]] as Coord
  const max: Coord = [...coords[0]] as Coord
  for (const [x, y, z] of coords) {
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (z < min[2]) min[2] = z
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
    if (z > max[2]) max[2] = z
  }
  return { min, max }
}

/**
 * Grid-space bounds of a plane-frame selection window: the (u,v) rect mapped onto the
 * construction plane at its offset. The window is one slice thick, so both corners share the
 * plane-axis coordinate — the result is a slab lying on the plane. Opposite corners suffice
 * because the plane mapping is axis-aligned (possibly flipped per orientation); min/max absorbs
 * the flip. Mirrors the rect the 2D canvas outlines with marching ants, in 3D.
 */
export function windowSlabBounds(region: SelectionRegion, plane: ConstructionPlane): { min: Coord; max: Coord } {
  const a = gridCoordFromPixel(plane, region.originU, region.originV)
  const b = gridCoordFromPixel(plane, region.originU + region.width - 1, region.originV + region.height - 1)
  const min: Coord = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])]
  const max: Coord = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]
  return { min, max }
}

/**
 * Every cell of the construction-plane slice under a plane-rectangle marquee (the 3D window
 * select): occupied or empty, the full dragged rect at the plane offset. The selection is the
 * window itself — the box reads the dragged rect and later edits apply window-wide — so empty
 * cells are included, not just occupied voxels. Out-of-grid corners are dropped. Callers snap
 * the result to the 3D selection as-is.
 */
export function windowSliceCells(
  plane: ConstructionPlane,
  from: Coord,
  to: Coord,
  gridExtent: GridExtent,
): CellKey[] {
  const a = pixelFromGridCoord(plane, from)
  const b = pixelFromGridCoord(plane, to)
  const minU = Math.min(a.u, b.u)
  const maxU = Math.max(a.u, b.u)
  const minV = Math.min(a.v, b.v)
  const maxV = Math.max(a.v, b.v)
  const keys: CellKey[] = []
  for (let u = minU; u <= maxU; u++) {
    for (let v = minV; v <= maxV; v++) {
      const coord = gridCoordFromPixel(plane, u, v)
      if (!withinWorkingBounds(coord, gridExtent)) continue
      keys.push(encodeKey(...coord))
    }
  }
  return keys
}

/** Live snapshots for a key set, skipping missing cells (stale keys are benign). */
export function snapshotCells(model: VoxelModel, keys: Iterable<CellKey>): CellSnapshot[] {
  const out: CellSnapshot[] = []
  for (const key of keys) {
    const color = model.color.get(key)
    if (!color) continue
    const chamfer = model.chamfer.get(key)
    out.push({
      coord: decodeKey(key),
      paletteSlot: color.paletteSlot,
      chamfer: chamfer ? cloneChamfer(chamfer) : undefined,
    })
  }
  return out
}

/**
 * Snapshots an explicit voxel set as clipboard content anchored at its bbox-min, for exact-set
 * lift/copy (3D selection moves). du/dv run in the given plane's logical frame, dw along the
 * plane axis off the bbox-min depth — the same dressing `copyRegionToClipboard` applies, so the
 * existing move/transform/bake/ghost path consumes the result unchanged.
 */
export function copyCellsToClipboard(
  model: VoxelModel,
  keys: Iterable<CellKey>,
  plane: ConstructionPlane,
): ClipboardData {
  const entries = snapshotCells(model, keys)
  if (entries.length === 0) return { width: 0, height: 0, cells: [], copyPlaneAxis: plane.axis, copyPlaneOrientation: plane.orientation, copyPlaneOffset: plane.offset, depthAnchor: 'bbox' as const }
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  let minW = Infinity
  const ai = axisIndex(plane.axis)
  const projected: Array<{ u: number; v: number; w: number }> = entries.map((e) => {
    const { u, v } = pixelFromGridCoord(plane, e.coord)
    const w = e.coord[ai]
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
    if (w < minW) minW = w
    return { u, v, w }
  })
  const cells: ClipboardCell[] = entries.map((e, i) => ({
    du: projected[i].u - minU,
    dv: projected[i].v - minV,
    dw: projected[i].w - minW,
    color: { paletteSlot: e.paletteSlot },
    chamfer: e.chamfer,
  }))
  return {
    width: maxU - minU + 1,
    height: maxV - minV + 1,
    originU: minU,
    originV: minV,
    cells,
    copyPlaneAxis: plane.axis,
    copyPlaneOrientation: plane.orientation,
    copyPlaneOffset: minW,
    depthAnchor: 'bbox' as const,
  }
}

/**
 * Rotates/mirrors explicit voxel snapshots about their bbox center in the given plane — the same
 * origin-corner-preserving math as float `rotateClipboard90`/`mirrorClipboard` (see transform.ts),
 * so 3D and 2D transforms agree exactly. Depth along the plane axis is preserved per cell;
 * results landing outside the grid are dropped (matching paste's drop rule); chamfers renumber
 * through the exact-solid duals, so no square constraint is needed.
 */
export function rotateCellsInPlane(
  entries: CellSnapshot[],
  plane: ConstructionPlane,
  kind: SelectionTransformKind,
  gridExtent: GridExtent,
): CellSnapshot[] {
  if (entries.length === 0) return []
  const ai = axisIndex(plane.axis)
  // Bounding box without spreading per-cell arrays into Math.min/Math.max (RangeError past
  // ~200k cells): the plane mapping is axis-aligned, so projecting the xyz bbox corners
  // yields the exact (u,v) span.
  const bbox = bboxOfCoords(entries.map((e) => e.coord))
  if (!bbox) return []
  const cornerA = pixelFromGridCoord(plane, bbox.min)
  const cornerB = pixelFromGridCoord(plane, bbox.max)
  const minU = Math.min(cornerA.u, cornerB.u)
  const maxU = Math.max(cornerA.u, cornerB.u)
  const minV = Math.min(cornerA.v, cornerB.v)
  const maxV = Math.max(cornerA.v, cornerB.v)
  type UVW = { u: number; v: number; w: number }
  const uvs: UVW[] = entries.map((e) => {
    const { u, v } = pixelFromGridCoord(plane, e.coord)
    return { u, v, w: e.coord[ai] }
  })
  const spin = kind === 'rotate' ? 'cw' : kind === 'rotate-ccw' ? 'ccw' : null

  const out: CellSnapshot[] = []
  entries.forEach((e, i) => {
    const { u, v, w } = uvs[i]
    let nu: number
    let nv: number
    let chamfer = e.chamfer
    if (spin) {
      if (spin === 'cw') {
        nu = minU + maxV - v
        nv = minV + u - minU
      } else {
        nu = minU + v - minV
        nv = minV + maxU - u
      }
      if (chamfer) {
        chamfer = rotateChamferCell(chamfer, plane.axis, spin)
      }
    } else {
      const mirrorU = kind === 'mirror-h'
      nu = mirrorU ? minU + maxU - u : u
      nv = mirrorU ? v : minV + maxV - v
      if (chamfer) {
        chamfer = mirrorChamferCell(chamfer, plane.axis, mirrorU, !mirrorU)
      }
    }
    const coord = gridCoordFromPixel({ ...plane, offset: w }, nu, nv)
    if (!withinWorkingBounds(coord, gridExtent)) return
    out.push({ coord, paletteSlot: e.paletteSlot, chamfer })
  })
  return out
}

/**
 * Whether every key in an explicit voxel set sits on the active construction-plane slice.
 * Empty sets read as not-coplanar (there is nothing to route to the 2D clipboard).
 * Stale keys decode like any other cell — off-slice keys fail the check.
 */
export function isCoplanarWithPlane(keys: Iterable<CellKey>, plane: ConstructionPlane): boolean {
  let seen = false
  const ai = axisIndex(plane.axis)
  for (const key of keys) {
    seen = true
    if (decodeKey(key)[ai] !== plane.offset) return false
  }
  return seen
}

/**
 * Expresses a coplanar explicit voxel set as a plane-framed 2D selection window: bounding
 * (u,v) rect in the plane's logical frame with the mask set exactly on the set's cells
 * (holes stay holes). Unoccupied window cells are not selected, so pasting stamps only the
 * copied cells instead of clearing the whole rect (occupied-only, not the full window).
 * Returns null for empty sets. Callers must check `isCoplanarWithPlane` first — off-plane
 * keys project onto the slice and would silently collapse depth.
 */
export function selectionRegionFromCoplanarCells(
  keys: Iterable<CellKey>,
  plane: ConstructionPlane,
): SelectionRegion | null {
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  const uvs: Array<{ u: number; v: number }> = []
  for (const key of keys) {
    const { u, v } = pixelFromGridCoord(plane, decodeKey(key))
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
    uvs.push({ u, v })
  }
  if (uvs.length === 0) return null
  const width = maxU - minU + 1
  const height = maxV - minV + 1
  const mask = new Uint8Array(width * height)
  for (const { u, v } of uvs) mask[(v - minV) * width + (u - minU)] = 1
  return { originU: minU, originV: minV, width, height, mask }
}

/**
 * Whether an explicit voxel set frames the given clipboard exactly: the set's bounding box,
 * measured in the plane's (u,v) + depth frame, matches the clipboard's width/height/depth
 * span. Used by 3D paste to recognize an empty selection as a paste destination ("paste into
 * the selection") rather than floating in place.
 *
 * Returns the destination frame — the selection bbox's min corner plus the clipboard's own
 * min depth offset — or null when the frames differ (or either side is empty). Sizes are
 * flip-invariant, so plane orientation never matters.
 */
export function selectionMatchesClipboard(
  keys: Iterable<CellKey>,
  clipboard: ClipboardData,
  plane: ConstructionPlane,
): { originU: number; originV: number; minW: number; minDw: number } | null {
  const coords: Coord[] = []
  for (const key of keys) coords.push(decodeKey(key))
  if (coords.length === 0 || clipboard.cells.length === 0) return null
  const bbox = bboxOfCoords(coords)
  if (!bbox) return null
  const { min, max } = bbox
  const a = pixelFromGridCoord(plane, min)
  const b = pixelFromGridCoord(plane, max)
  const ai = axisIndex(plane.axis)
  let minDw = Infinity
  let maxDw = -Infinity
  for (const cell of clipboard.cells) {
    if (cell.dw < minDw) minDw = cell.dw
    if (cell.dw > maxDw) maxDw = cell.dw
  }
  if (
    Math.abs(a.u - b.u) + 1 !== clipboard.width ||
    Math.abs(a.v - b.v) + 1 !== clipboard.height ||
    Math.abs(max[ai] - min[ai]) + 1 !== maxDw - minDw + 1
  ) {
    return null
  }
  return {
    originU: Math.min(a.u, b.u),
    originV: Math.min(a.v, b.v),
    minW: Math.min(min[ai], max[ai]),
    minDw,
  }
}
