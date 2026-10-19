import { decodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { CellKey, ChamferCell, Coord, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import type { ConstructionPlane } from '@/engine/plane/types'
import { mirrorChamferCell, rotateChamferCell } from '@/engine/chamfer/chamferTransform'
import type { ClipboardCell, ClipboardData, SelectionTransformKind } from '@/store/types'

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
 * Occupied cells under a plane-rectangle marquee (the 3D marquee gesture): every model voxel
 * whose plane projection falls in the dragged (u,v) range, at any depth. Callers snap the
 * result to the 3D selection as-is (already minimal — empty margins never enter).
 */
export function footprintOccupiedCells(
  model: VoxelModel,
  plane: ConstructionPlane,
  from: Coord,
  to: Coord,
): CellKey[] {
  const a = pixelFromGridCoord(plane, from)
  const b = pixelFromGridCoord(plane, to)
  const minU = Math.min(a.u, b.u)
  const maxU = Math.max(a.u, b.u)
  const minV = Math.min(a.v, b.v)
  const maxV = Math.max(a.v, b.v)
  const keys: CellKey[] = []
  for (const key of model.color.keys()) {
    const { u, v } = pixelFromGridCoord(plane, decodeKey(key))
    if (u >= minU && u <= maxU && v >= minV && v <= maxV) keys.push(key)
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
      chamfer: chamfer
        ? { planeAxis: chamfer.planeAxis, planeOrientation: chamfer.planeOrientation, resolvedTo: chamfer.resolvedTo ? { ...chamfer.resolvedTo } : null }
        : undefined,
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
  if (entries.length === 0) return { width: 0, height: 0, cells: [], copyPlaneAxis: plane.axis, copyPlaneOrientation: plane.orientation, copyPlaneOffset: plane.offset }
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
  type UVW = { u: number; v: number; w: number }
  const uvs: UVW[] = entries.map((e) => {
    const { u, v } = pixelFromGridCoord(plane, e.coord)
    return { u, v, w: e.coord[ai] }
  })
  const us = uvs.map((p) => p.u)
  const vs = uvs.map((p) => p.v)
  const minU = Math.min(...us)
  const maxU = Math.max(...us)
  const minV = Math.min(...vs)
  const maxV = Math.max(...vs)
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
