import * as THREE from 'three'
import { decodeKey, encodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { CellKey, ChamferCell, Coord, GridExtent, VoxelModel } from '@/engine/grid/types'
import { splitChildOrigin, splitChildSize } from '@/engine/grid/subdiv'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { placeClipboardCell } from '@/engine/tools/clipboard'
import { resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { forEachSelectedCell } from '@/engine/tools/selectionMask'
import type { ClipboardData, FloatOrigin, SelectionRegion } from '@/store/types'
import { chamferInstanceMatrix, cubeInstanceMatrix, scaledChamferInstanceMatrix, subCubeInstanceMatrix } from './basis'
import { poolIdFor, type PoolId } from './pools'

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

  for (const cell of floatContent.cells) {
    const coord = placeClipboardCell(plane, floatContent, floatOrigin.originU, floatOrigin.originV, cell)
    // Cells dragged off-grid are dropped by `applyClipboardAt` on bake — don't promise them here.
    if (!withinWorkingBounds(coord, gridExtent)) continue
    if (cell.subdiv) {
      // Floating detail ghosts per child in its shape's pool (scaled boxes and bevels);
      // erased holes ghost nothing (they clear on bake — clearing renders as absence).
      for (let o = 0; o < cell.subdiv.children.length; o++) {
        const child = cell.subdiv.children[o]
        if (!child) continue
        const origin = splitChildOrigin(coord, cell.subdiv.split, o)
        const size = splitChildSize(cell.subdiv.split)
        const resolved = child.chamfer?.resolvedTo
        if (resolved) {
          const chamfer = child.chamfer!
          const poolId = poolIdFor(child.chamfer)
          const matrix = scaledChamferInstanceMatrix(origin, size, chamfer.planeAxis, chamfer.planeOrientation, resolved.rotation)
          pushMatrixInto(byPool, poolId, matrix, new THREE.Color(resolveSlotColor(palette, child.slot)))
        } else {
          pushMatrixInto(
            byPool,
            'cube',
            subCubeInstanceMatrix(origin, size),
            new THREE.Color(resolveSlotColor(palette, child.slot)),
          )
        }
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
  for (const cell of floatContent.cells) {
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
        const origin = splitChildOrigin(coord, sub.split, o)
        const size = splitChildSize(sub.split)
        const resolved = child.chamfer?.resolvedTo
        if (resolved) {
          const chamfer = child.chamfer!
          pushMatrixInto(
            byPool,
            poolIdFor(child.chamfer),
            scaledChamferInstanceMatrix(origin, size, chamfer.planeAxis, chamfer.planeOrientation, resolved.rotation),
          )
        } else {
          pushMatrixInto(byPool, 'cube', subCubeInstanceMatrix(origin, size))
        }
      }
      return
    }
    if (!model.color.has(key)) return
    lit.add(key)
    pushInto(byPool, coord, model.chamfer.get(key))
  }

  if (selection) {
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
