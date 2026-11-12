import * as THREE from 'three'
import { decodeKey, encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { CellKey, ChamferCell, Coord, DetailChild, GridExtent, VoxelModel } from '@/engine/grid/types'
import { splitChildOrigin, splitChildSize } from '@/engine/grid/subdiv'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { fineCellWorldBox, forEachFineCell } from '@/engine/tools/fineSelection'
import { floatPieces } from '@/engine/tools/fineFloat'
import { placeClipboardCell } from '@/engine/tools/clipboard'
import { resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { forEachSelectedCell } from '@/engine/tools/selectionMask'
import type { ClipboardData, FloatOrigin, SelectionRegion } from '@/store/types'
import { chamferInstanceMatrix, cubeInstanceMatrix, subCubeInstanceMatrix } from './basis'
import { detailInstance, poolIdFor, type PoolId } from './pools'

/**
 * One instanced draw's worth of overlay cells: everything sharing a pool, and so a geometry.
 * `colors` is per-instance tinting; omitted when the whole overlay is a single flat color.
 */
export type GhostBatch = {
  poolId: PoolId
  matrices: THREE.Matrix4[]
  colors?: THREE.Color[]
}

/** Placement for one cell, using its baked shape — the same matrix the live renderer would use. */
function instanceMatrixFor(coord: Coord, chamfer: ChamferCell | undefined): THREE.Matrix4 {
  return chamfer?.resolvedTo
    ? chamferInstanceMatrix(coord, chamfer.planeAxis, chamfer.planeOrientation, chamfer.resolvedTo.rotation)
    : cubeInstanceMatrix(coord)
}

function pushInto(byPool: Map<PoolId, GhostBatch>, coord: Coord, chamfer: ChamferCell | undefined, color?: THREE.Color): void {
  const poolId = poolIdFor(chamfer)
  let batch = byPool.get(poolId)
  if (!batch) {
    batch = { poolId, matrices: [], colors: color ? [] : undefined }
    byPool.set(poolId, batch)
  }
  batch.matrices.push(instanceMatrixFor(coord, chamfer))
  if (color) batch.colors!.push(color)
}

/** Pushes one detail child / float piece (scaled bevel or box) into its pool batch. */
function pushDetail(byPool: Map<PoolId, GhostBatch>, origin: [number, number, number], size: [number, number, number], child: Pick<DetailChild, 'chamfer'>, color?: THREE.Color): void {
  const { poolId, matrix } = detailInstance(origin, size, child)
  pushMatrixInto(byPool, poolId, matrix, color)
}

/** Pushes a precomputed matrix (detail half-cubes) into a pool batch. */
function pushMatrixInto(byPool: Map<PoolId, GhostBatch>, poolId: PoolId, matrix: THREE.Matrix4, color?: THREE.Color): void {
  let batch = byPool.get(poolId)
  if (!batch) {
    batch = { poolId, matrices: [], colors: color ? [] : undefined }
    byPool.set(poolId, batch)
  }
  batch.matrices.push(matrix)
  if (color) batch.colors!.push(color)
}

/**
 * Lays out the floating selection for rendering as a semi-transparent 3D ghost (see
 * `FloatGhostPreview.tsx`), grouped into the same instancing pools the live `InstancingManager`
 * uses so a float and the model it bakes into agree on every cell's shape.
 *
 * Placement goes through the shared `placeClipboardCell`, so the ghost is a truthful preview of
 * the bake rather than an approximation of it.
 */
export function buildFloatGhostBatches(
  floatContent: ClipboardData | null,
  floatOrigin: FloatOrigin | null,
  plane: ConstructionPlane,
  palette: PaletteState,
  gridExtent: GridExtent,
): GhostBatch[] {
  if (!floatContent || !floatOrigin) return []
  const byPool = new Map<PoolId, GhostBatch>()

  if (floatContent.fine) {
    // Sub-voxel float: one box per piece, at its exact (half-voxel) place — beveled pieces
    // ghost in their shape's pool, like floating detail children do below.
    for (const piece of floatPieces(plane, floatContent, floatOrigin.originU, floatOrigin.originV, floatOrigin.subU ?? 0, floatOrigin.subV ?? 0)) {
      if (!withinWorkingBounds(piece.cell, gridExtent)) continue
      const origin: [number, number, number] = [piece.cell[0] + piece.origin[0], piece.cell[1] + piece.origin[1], piece.cell[2] + piece.origin[2]]
      pushDetail(byPool, origin, piece.size, piece, new THREE.Color(resolveSlotColor(palette, piece.slot)))
    }
  }

  for (const cell of floatContent.cells) {
    if (floatContent.fine && !cell.chamfer) continue // pieces above
    const coord = placeClipboardCell(plane, floatContent, floatOrigin.originU, floatOrigin.originV, cell)
    // Cells dragged off-grid are dropped by `applyClipboardAt` on bake — don't promise them here.
    if (!withinWorkingBounds(coord, gridExtent)) continue
    if (cell.subdiv) {
      // Floating detail ghosts per child in its shape's pool (scaled boxes and bevels);
      // erased holes ghost nothing (they clear on bake — clearing renders as absence).
      for (let o = 0; o < cell.subdiv.children.length; o++) {
        const child = cell.subdiv.children[o]
        if (!child) continue
        pushDetail(byPool, splitChildOrigin(coord, cell.subdiv.split, o), splitChildSize(cell.subdiv.split), child, new THREE.Color(resolveSlotColor(palette, child.slot)))
      }
      continue
    }
    // A cell with no color paints nothing when baked, so it has nothing to ghost either.
    // (It still clears on bake — replace semantics — but clearing renders as absence.)
    if (!cell.color) continue
    pushInto(byPool, coord, cell.chamfer, new THREE.Color(resolveSlotColor(palette, cell.color.paletteSlot)))
  }

  return [...byPool.values()]
}

/**
 * Current grid-space footprint of a pending float: every placed cell coordinate within working
 * bounds. Placement goes through the shared `placeClipboardCell`, so the box and the ghost
 * agree on where the drag is. Only cells with color are included, matching what the ghost renders
 * (colorless cells clear on bake but paint nothing, so they contribute no visible drag).
 *
 * Used by the 3D selection bounding box to track a dragged selection: a lift deletes the cells
 * out of the model, leaving the selection set stale, but the float knows where its cells live
 * right now and `floatOrigin` follows the pointer every frame.
 */
export function placedFloatCoords(
  floatContent: ClipboardData | null,
  floatOrigin: FloatOrigin | null,
  plane: ConstructionPlane,
  gridExtent: GridExtent,
): Coord[] {
  if (!floatContent || !floatOrigin) return []
  const out: Coord[] = []
  if (floatContent.fine) {
    for (const piece of floatPieces(plane, floatContent, floatOrigin.originU, floatOrigin.originV, floatOrigin.subU ?? 0, floatOrigin.subV ?? 0)) {
      if (withinWorkingBounds(piece.cell, gridExtent)) out.push(piece.cell)
    }
  }
  for (const cell of floatContent.cells) {
    if (floatContent.fine && !cell.chamfer) continue
    if (!cell.color && !cell.subdiv) continue
    const coord = placeClipboardCell(plane, floatContent, floatOrigin.originU, floatOrigin.originV, cell)
    if (!withinWorkingBounds(coord, gridExtent)) continue
    out.push(coord)
  }
  return out
}

/**
 * Lays out the voxels under a (non-floating) selection so 3D can cast the same cyan over them that
 * the 2D canvas tints them with — the selection is otherwise invisible in 3D, leaving no clue which
 * voxels a delete or transform is about to hit.
 *
 * Only cells that actually hold a voxel are included: the selection is a rectangle-or-lasso mask
 * over the plane, and casting empty space would read as a floating cyan slab. `extraCells` lights
 * an explicit grid-space set (the 3D selection store) at every depth alongside the slice cast —
 * callers pass already-resolved keys; missing/out-of-grid keys are skipped benignly. Overlap
 * between the two casts draws once (shared dedupe set).
 *
 * No per-instance colors — the whole overlay is one flat tint, so the caller's material carries it.
 */
export function buildSelectionHighlightBatches(
  model: VoxelModel,
  plane: ConstructionPlane,
  selection: SelectionRegion | null,
  gridExtent: GridExtent,
  extraCells: Iterable<CellKey> | null = null,
): GhostBatch[] {
  if (!selection && !extraCells) return []
  const byPool = new Map<PoolId, GhostBatch>()
  const lit = new Set<string>()

  const pushCell = (coord: Coord) => {
    if (!withinWorkingBounds(coord, gridExtent)) return
    const key = encodeKey(...coord)
    if (lit.has(key)) return
    const sub = model.subdiv.get(key)
    if (sub) {
      // Selected detail highlights per child (scaled boxes and bevels; erased holes stay dark).
      lit.add(key)
      for (let o = 0; o < sub.children.length; o++) {
        const child = sub.children[o]
        if (!child) continue
        pushDetail(byPool, splitChildOrigin(coord, sub.split, o), splitChildSize(sub.split), child)
      }
      return
    }
    if (!model.color.has(key)) return
    lit.add(key)
    pushInto(byPool, coord, model.chamfer.get(key))
  }

  if (selection?.fine) {
    // Sub-voxel selection: cast only the selected parts — children overlapping a selected fine
    // cell, or a box over the fine cell itself for a plain cube. Chamfer cells are atomic.
    const f = selection.fine
    forEachFineCell(selection, (fu, fv) => {
      const u = Math.floor(fu / f.su)
      const v = Math.floor(fv / f.sv)
      const coord = gridCoordFromPixel(plane, u, v)
      if (!withinWorkingBounds(coord, gridExtent)) return
      const key = encodeKey(...coord)
      if (model.chamfer.has(key)) {
        pushCell(coord)
        return
      }
      const { origin, size } = fineCellWorldBox(plane, selection, fu, fv)
      const sub = model.subdiv.get(key)
      if (sub) {
        const csize = splitChildSize(sub.split)
        for (let o = 0; o < sub.children.length; o++) {
          const child = sub.children[o]
          const tag = `${key}#${o}`
          if (!child || lit.has(tag)) continue
          const co = splitChildOrigin(coord, sub.split, o)
          let overlaps = true
          for (let a = 0; a < 3; a++) {
            if (Math.min(co[a] + csize[a], origin[a] + size[a]) - Math.max(co[a], origin[a]) <= 1e-9) overlaps = false
          }
          if (!overlaps) continue
          lit.add(tag)
          pushDetail(byPool, co, csize, child)
        }
        return
      }
      if (!model.color.has(key)) return
      const tag = `${key}@${origin.join(',')}`
      if (lit.has(tag)) return
      lit.add(tag)
      pushMatrixInto(byPool, 'cube', subCubeInstanceMatrix(origin, size))
    })
  } else if (selection) {
    forEachSelectedCell(selection, (u, v) => {
      pushCell(gridCoordFromPixel(plane, u, v))
    })
  }

  if (extraCells) {
    for (const key of extraCells) {
      pushCell(decodeKey(key))
    }
  }

  return [...byPool.values()]
}
