import type { StateCreator } from 'zustand'
import { decodeKey, encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { getSubdivCell, sampleBoxNeighborhood } from '@/engine/grid/subdiv'
import { childBox, exactChildIndex, gridBox, gridBoxAtBits, isWholeBox, planeFrame, recolorBox, worldBitsFromQuad, writeBox, WHOLE_BOX, type CellBox } from '@/engine/grid/cellBox'
import type { Axis, CellKey, Coord, Orientation, Rotation } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { spinSlabAboutLocalY } from '@/engine/chamfer/chamferTransform'
import { findDualRampRotation, findWedgeRampDual } from '@/engine/chamfer/rampDual'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { dominantAxisLine, dominantAxisLineFine } from '@/engine/tools/lineUtils'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { isCellSelected, forEachSelectedCell } from '@/engine/tools/selectionMask'
import { fineCellBox, fineDivisionFor, forEachFineCell, isSelectedAt } from '@/engine/tools/fineSelection'
import { paintFineRegion } from '@/engine/grid/fineOps'
import { liveFineSelection3D } from './selection3DSlice'
import type { AppState, PaintActionsSlice, VoxelKind } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PaintActionsSlice>

let freshChamferKeys: Set<string> | null = null
// Wedge cells painted this stroke that haven't yet matched a real 2-neighbor corner — still at
// their rotation-0 fallback and eligible for retry as more of the stroke gets painted. A key
// leaves this set (frozen) as soon as it finds a true match, even mid-stroke.
let pendingWedgeKeys: Set<string> | null = null
// Thin/half cells touched this stroke. Re-clicking a slab spins it (see below), but a drag's
// Bresenham interpolation re-applies cells already visited this stroke — without this guard
// the stroke's own anchor cell would spin on the first move event. Mirrors pendingWedgeKeys.
let strokeSlabKeys: Set<string> | null = null
// Chamfer cells touched this stroke (any bevel kind). Discrete re-clicks cycle the bevel
// (rotate, then advance the family past a full turn); drag revisits keep the current
// per-kind behavior instead, so sweeps never spin what they just painted.
let strokeChamferKeys: Set<string> | null = null
// Detail-scale twins of the two sets above, keyed `${parentKey}/${childIndex}`: ramp children
// painted while unclassifiable (still rendering as cubes) and wedge children still at their
// rotation-0 fallback. Retried as the stroke paints their neighbors, then settled slice-wide.
let freshDetailKeys: Set<string> | null = null
let pendingDetailWedgeKeys: Set<string> | null = null
// Detail-scale touched set: same drag-revisit guard as strokeChamferKeys, per child.
let strokeDetailKeys: Set<string> | null = null

export function beginFreshChamferTracking() {
  freshChamferKeys = new Set()
  pendingWedgeKeys = new Set()
  strokeSlabKeys = new Set()
  strokeChamferKeys = new Set()
  freshDetailKeys = new Set()
  pendingDetailWedgeKeys = new Set()
  strokeDetailKeys = new Set()
}

export function endFreshChamferTracking() {
  freshChamferKeys = null
  pendingWedgeKeys = null
  strokeSlabKeys = null
  strokeChamferKeys = null
  freshDetailKeys = null
  pendingDetailWedgeKeys = null
  strokeDetailKeys = null
}

/** The autotile bevel family, in cycle order: re-clicking rotates, and completing a full
 * turn advances to the next shape. */
const BEVEL_FAMILY = ['ramp', 'convex', 'concave', 'wedge'] as const
type BevelFamilyKind = (typeof BEVEL_FAMILY)[number]

function isBevelFamilyKind(shapeKind: string | undefined): shapeKind is BevelFamilyKind {
  return shapeKind === 'ramp' || shapeKind === 'convex' || shapeKind === 'concave' || shapeKind === 'wedge'
}

/**
 * One step of the bevel re-click cycle: rotate 90°, or — when that would return to the
 * brush home orientation (a full turn completed) — advance to the next family shape at
 * home instead. Stateless: every click visibly changes the voxel, so drag revisits (which
 * keep the current per-kind behavior via the touched sets) never accidentally advance it.
 */
function nextBevelTurn(shape: BevelFamilyKind, rotation: Rotation, brush: Rotation): { shapeKind: BevelFamilyKind; rotation: Rotation } {
  const next = ((rotation + 1) % 4) as Rotation
  if (next === brush) return { shapeKind: BEVEL_FAMILY[(BEVEL_FAMILY.indexOf(shape) + 1) % BEVEL_FAMILY.length], rotation: brush }
  return { shapeKind: shape, rotation: next }
}

/**
 * The box a plane-targeted edit at logical quadrant (qu, qv) addresses under the armed grid
 * (whole voxel when the grid is whole; the quadrant's half on cut in-plane axes, full extent
 * when the gesture has no continuous position; the plane's slab on a cut plane axis).
 */
function editBox(state: AppState, plane: ConstructionPlane, qu?: number, qv?: number): CellBox {
  const bits = qu === undefined || qv === undefined ? null : worldBitsFromQuad(plane, qu, qv)
  return gridBox(plane, state.gridSplit, bits)
}

function markDirty(state: AppState) {
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
}

/**
 * THE paint write, for every view and gesture: a whole box runs the unit paint path (replacing
 * any detail with one voxel — the whole grid writes whole voxels); a sub-voxel box writes
 * detail through `writeBox` (cubes) or `paintDetailBevel` (shape kinds). Callers run this
 * inside their own set() producer so the stroke stays one undo step.
 */
function paintBox(
  state: AppState,
  plane: ConstructionPlane,
  coord: Coord,
  u: number,
  v: number,
  box: CellBox,
  kind: VoxelKind,
  slot: PaletteSlotRef,
  stamp: boolean,
) {
  if (isWholeBox(box)) {
    applyPaintCell(state, coord, u, v, plane, kind, slot, stamp)
    return
  }
  if (kind === 'cube') writeBox(state.model, coord, box, { slot })
  else paintDetailBevel(state, plane, coord, box, slot, kind, stamp)
  markDirty(state)
}

/**
 * The paint-cell write itself, parameterized by an explicit plane instead of the store's active
 * one. `paintCell` (2D) passes `get().plane` plus its selection clip; `paintCellAtCoord` (3D
 * direct) passes the active construction plane at the target's slice. One
 * implementation, so chamfer classification, wedge retry, and tracking behave identically from
 * either view.
 *
 * `stamp` switches from click semantics to fill semantics: every cell lands the brush shape
 * deterministically (fresh classification at the brush rotation) instead of applying
 * re-click rotation/spin/cycle to already-matching cells — bulk-filling a window must stamp,
 * never spin what it just wrote. Tracking sets are left alone in stamp mode.
 */
function applyPaintCell(
  state: AppState,
  coord: Coord,
  u: number,
  v: number,
  plane: ConstructionPlane,
  kind: VoxelKind,
  slot: PaletteSlotRef,
  stamp = false,
) {
  const key = encodeKey(...coord)
  // Whole-voxel writes own the footprint: any detail underneath is replaced (see paintBox).
  state.model.subdiv.delete(key)
  state.model.color.set(key, { paletteSlot: slot })
  state.model.bounds = expandBounds(state.model.bounds, coord)
  // Manual brush rotation (R key / preview button): an additive quarter-turn offset applied to
  // orientable kinds at paint time. 0 preserves legacy behavior exactly (pure autotile / fresh-0).
  const brush = (state.brushRotation ?? 0) as Rotation

  if (kind === 'ramp') {
    const reclick = !stamp && state.model.chamfer.get(key)?.resolvedTo
    if (reclick && isBevelFamilyKind(reclick.shapeKind) && !strokeChamferKeys?.has(key)) {
      // Re-click on a family bevel: rotate, advancing the family once a full turn
      // completes — no neighbor sampling (the shape is explicitly revisited, not fresh).
      const turned = nextBevelTurn(reclick.shapeKind, reclick.rotation, brush)
      state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: turned.shapeKind, rotation: turned.rotation } })
      freshChamferKeys?.delete(key)
      pendingWedgeKeys?.delete(key)
      strokeChamferKeys?.add(key)
      return
    }
    const resolvedTo = classify(sampleNeighbors(state.model, plane, u, v))
    if (resolvedTo && brush) resolvedTo.rotation = ((resolvedTo.rotation + brush) % 4) as Rotation
    state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo })
    strokeChamferKeys?.add(key)

    if (!stamp && freshChamferKeys) {
      freshChamferKeys.add(key)
      const pi = axisIndex(plane.axis)
      for (const freshKey of freshChamferKeys) {
        const cell = state.model.chamfer.get(freshKey)
        if (!cell || cell.resolvedTo) continue
        const fc = decodeKey(freshKey)
        if (fc[pi] !== plane.offset) continue
        const { u: fu, v: fv } = pixelFromGridCoord(plane, fc)
        const rt = classify(sampleNeighbors(state.model, plane, fu, fv))
        // Same brush offset as the fresh paint above, or the retry would silently un-rotate
        // the preview/ghost's promised shape.
        if (rt) cell.resolvedTo = brush ? { ...rt, rotation: ((rt.rotation + brush) % 4) as Rotation } : rt
      }
    }
  } else if (kind === 'wedge') {
    const existing = state.model.chamfer.get(key)
    const reclick = !stamp && existing?.resolvedTo
    if (reclick && isBevelFamilyKind(reclick.shapeKind) && !strokeChamferKeys?.has(key)) {
      // Re-click on a family bevel: rotate, advancing the family once a full turn
      // completes — no neighbor sampling (the shape is explicitly revisited, not fresh).
      const turned = nextBevelTurn(reclick.shapeKind, reclick.rotation, brush)
      state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: turned.shapeKind, rotation: turned.rotation } })
      freshChamferKeys?.delete(key)
      pendingWedgeKeys?.delete(key)
      strokeChamferKeys?.add(key)
      return
    }
    const alreadyFinalized = !stamp && existing?.resolvedTo?.shapeKind === 'wedge' && !pendingWedgeKeys?.has(key)

    if (alreadyFinalized) {
      // Same-stroke revisit of a locked-in wedge: rotate it 90° in place (drag
      // interpolation re-applies visited cells; discrete re-clicks cycle instead, above).
      const rotation = ((existing!.resolvedTo!.rotation + 1) % 4) as Rotation
      existing!.resolvedTo = { shapeKind: 'wedge', rotation }
    } else {
      const resolved = classify(sampleNeighbors(state.model, plane, u, v))
      const rotation = (((resolved?.shapeKind === 'convex' ? resolved.rotation : 0) + brush) % 4) as Rotation
      state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: 'wedge', rotation } })

      if (!stamp && pendingWedgeKeys) {
        if (resolved?.shapeKind === 'convex') pendingWedgeKeys.delete(key)
        else pendingWedgeKeys.add(key)

        const pi = axisIndex(plane.axis)
        for (const pendingKey of pendingWedgeKeys) {
          const cell = state.model.chamfer.get(pendingKey)
          if (!cell) {
            pendingWedgeKeys.delete(pendingKey)
            continue
          }
          const pc = decodeKey(pendingKey)
          if (pc[pi] !== plane.offset) continue
          const { u: pu, v: pv } = pixelFromGridCoord(plane, pc)
          const rt = classify(sampleNeighbors(state.model, plane, pu, pv))
          if (rt?.shapeKind === 'convex') {
            // Same brush offset as the fresh paint above (which falls back to rotation 0 +
            // brush until the corner completes).
            cell.resolvedTo = { shapeKind: 'wedge', rotation: ((rt.rotation + brush) % 4) as Rotation }
            pendingWedgeKeys.delete(pendingKey)
          }
        }
      }
    }
    strokeChamferKeys?.add(key)
  } else if (kind === 'convex' || kind === 'concave') {
    // Explicit corner kinds join the family cycle on re-click; fresh paints still land
    // verbatim at the brush rotation. Revisits within the same stroke are left untouched
    // so a drag's interpolation can't spin what the stroke just wrote.
    const existing = state.model.chamfer.get(key)
    if (!stamp && strokeSlabKeys?.has(key)) {
      // Already touched this stroke — leave the chamfer entry exactly as the stroke left it.
    } else if (!stamp && existing?.resolvedTo && isBevelFamilyKind(existing.resolvedTo.shapeKind) && !strokeChamferKeys?.has(key)) {
      // Re-click on a family bevel: rotate, advancing the family once a full turn completes.
      const turned = nextBevelTurn(existing.resolvedTo.shapeKind, existing.resolvedTo.rotation, brush)
      state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: turned.shapeKind, rotation: turned.rotation } })
      freshChamferKeys?.delete(key)
      pendingWedgeKeys?.delete(key)
    } else if (!stamp && existing?.resolvedTo?.shapeKind === kind) {
      const rotation = ((existing.resolvedTo.rotation + 1) % 4) as Rotation
      existing.resolvedTo = { shapeKind: kind, rotation }
    } else {
      state.model.chamfer.set(key, {
        planeAxis: plane.axis,
        planeOrientation: plane.orientation,
        resolvedTo: { shapeKind: kind, rotation: brush },
      })
    }
    strokeSlabKeys?.add(key)
    strokeChamferKeys?.add(key)
  } else if (kind === 'thin') {
    // Re-clicking a thin slab spins it 90° about the V it was painted on (the wedge-style
    // click-to-rotate escape hatch). Revisits within the same stroke are left untouched so a
    // drag's interpolated re-application can't spin (or clobber) what the stroke just wrote.
    const existing = state.model.chamfer.get(key)
    if (strokeSlabKeys?.has(key)) {
      // Already touched this stroke — leave the chamfer entry exactly as the stroke left it.
    } else if (!stamp && existing?.resolvedTo?.shapeKind === 'thin') {
      state.model.chamfer.set(key, spinSlabAboutLocalY(existing))
    } else {
      // A thin slab is a normal color cell plus a fixed chamfer entry recording only the
      // outward/thin axis. No neighbor sampling and no rotation — it's symmetric and never
      // auto-resolves (frozen at paint time, like every other shape once resolved).
      state.model.chamfer.set(key, {
        planeAxis: plane.axis,
        planeOrientation: plane.orientation,
        resolvedTo: { shapeKind: 'thin', rotation: 0 },
      })
    }
    strokeSlabKeys?.add(key)
  } else if (kind === 'half') {
    // Same click-to-rotate contract as thin: re-clicking a half slab spins it about the V it
    // was painted on. (Flipping the authoring orientation in place would move the slab to the
    // other half of the cell — a geometry edit — which is why rebase tools refuse halves;
    // spinning the facing is the escape hatch instead.)
    const existing = state.model.chamfer.get(key)
    if (strokeSlabKeys?.has(key)) {
      // Already touched this stroke — leave the chamfer entry exactly as the stroke left it.
    } else if (!stamp && existing?.resolvedTo?.shapeKind === 'half') {
      state.model.chamfer.set(key, spinSlabAboutLocalY(existing))
    } else {
      // A half slab is the flush sibling of the centered thin slab — but recessed, not proud:
      // the void faces the painter (negated orientation), so the voxel reads as set back next
      // to full neighbors instead of hiding an internal pocket behind a flush face.
      state.model.chamfer.set(key, {
        planeAxis: plane.axis,
        planeOrientation: plane.orientation === 1 ? -1 : 1,
        resolvedTo: { shapeKind: 'half', rotation: 0 },
      })
    }
    strokeSlabKeys?.add(key)
  } else if (kind === 'post') {
    // Re-clicking a post spins it 90° about the V it was painted on — the same click-to-rotate
    // contract as the slabs (the centered column's only free parameter is its long axis).
    // Revisits within the same stroke are left untouched, like the slab branches above.
    const existing = state.model.chamfer.get(key)
    if (strokeSlabKeys?.has(key)) {
      // Already touched this stroke — leave the chamfer entry exactly as the stroke left it.
    } else if (!stamp && existing?.resolvedTo?.shapeKind === 'post') {
      state.model.chamfer.set(key, spinSlabAboutLocalY(existing))
    } else {
      // A post is a centered 0.5×0.5 column running the full unit length along the outward
      // axis — the centered sibling of the thin slab with the axes swapped. Fully symmetric,
      // so no neighbor sampling and no rotation: frozen at paint time with rotation 0.
      state.model.chamfer.set(key, {
        planeAxis: plane.axis,
        planeOrientation: plane.orientation,
        resolvedTo: { shapeKind: 'post', rotation: 0 },
      })
    }
    strokeSlabKeys?.add(key)
  } else if (kind === 'quarter') {
    // Re-clicking a quarter cycles its occupied corner 90° (NE → SE → SW → NW) — the
    // wedge-style manual rotation, since the corner is the quarter's free parameter (its long
    // axis comes from the paint plane). Revisits within the same stroke are left untouched.
    const existing = state.model.chamfer.get(key)
    if (strokeSlabKeys?.has(key)) {
      // Already touched this stroke — leave the chamfer entry exactly as the stroke left it.
    } else if (!stamp && existing?.resolvedTo?.shapeKind === 'quarter') {
      const rotation = ((existing.resolvedTo.rotation + 1) % 4) as Rotation
      existing.resolvedTo = { shapeKind: 'quarter', rotation }
    } else {
      // A quarter is the post pushed into the NE corner — a 0.5×0.5×1 column in one quadrant,
      // full length along the outward axis. Fresh paints start at the brush rotation; re-click cycles corners.
      state.model.chamfer.set(key, {
        planeAxis: plane.axis,
        planeOrientation: plane.orientation,
        resolvedTo: { shapeKind: 'quarter', rotation: brush },
      })
    }
    strokeSlabKeys?.add(key)
  } else if (kind === 'flat') {
    // Re-clicking a flat spins it 90° about the V it was painted on — the same click-to-rotate
    // contract as the slabs (the centre quad's only free parameter is its facing normal), so one
    // click picks any of the three axes. Revisits within the same stroke are left untouched.
    const existing = state.model.chamfer.get(key)
    if (strokeSlabKeys?.has(key)) {
      // Already touched this stroke — leave the chamfer entry exactly as the stroke left it.
    } else if (!stamp && existing?.resolvedTo?.shapeKind === 'flat') {
      state.model.chamfer.set(key, spinSlabAboutLocalY(existing))
    } else {
      // A flat is thin's centre plane as a bare quad — frozen at paint time with rotation 0,
      // never auto-resolved. The editor renders the single quad DoubleSide; export emits both
      // windings (see voxelMeshBuilder's two-sided handling).
      state.model.chamfer.set(key, {
        planeAxis: plane.axis,
        planeOrientation: plane.orientation,
        resolvedTo: { shapeKind: 'flat', rotation: 0 },
      })
    }
    strokeSlabKeys?.add(key)
  } else if (kind === 'flatwedge') {
    // Re-clicking a flat wedge advances its rotation (the wedge-style manual rotation — the
    // diagonal is the free parameter; its plane comes from the paint plane). Revisits within
    // the same stroke are left untouched.
    const existing = state.model.chamfer.get(key)
    if (strokeSlabKeys?.has(key)) {
      // Already touched this stroke — leave the chamfer entry exactly as the stroke left it.
    } else if (!stamp && existing?.resolvedTo?.shapeKind === 'flatwedge') {
      const rotation = ((existing.resolvedTo.rotation + 1) % 4) as Rotation
      existing.resolvedTo = { shapeKind: 'flatwedge', rotation }
    } else {
      // A flat wedge is wedge's diagonal cut face as a bare quad — open NE corner at rotation 0
      // (the wedge convention), never resolver-created. Fresh paints start at the brush rotation; re-click cycles.
      state.model.chamfer.set(key, {
        planeAxis: plane.axis,
        planeOrientation: plane.orientation,
        resolvedTo: { shapeKind: 'flatwedge', rotation: brush },
      })
    }
    strokeSlabKeys?.add(key)
  } else {
    state.model.chamfer.delete(key)
  }

  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
}

/**
 * Bulk-fill write: stamps the brush onto a cell exactly as a fresh paint would (same
 * autotile/verbatim resolution from the live model), but never applies re-click
 * rotation/spin/cycle semantics — filling a window must stamp every cell deterministically,
 * never spin what the fill just wrote. Used by `fillSelection`; single-cell tools keep using
 * `applyPaintCell` directly.
 */
export function applyFillCell(
  state: AppState,
  coord: Coord,
  plane: ConstructionPlane,
  kind: VoxelKind,
  slot: PaletteSlotRef,
) {
  const { u, v } = pixelFromGridCoord(plane, coord)
  applyPaintCell(state, coord, u, v, plane, kind, slot, true)
}

/** Whole-voxel erase write (all layers, no selection concept) — `eraseCell` clips first, 3D skips it. */
function applyEraseCell(state: AppState, coord: Coord) {
  const key = encodeKey(...coord)
  state.model.color.delete(key)
  state.model.chamfer.delete(key)
  state.model.subdiv.delete(key)
  markDirty(state)
}

/** Erase write at one box: the whole voxel, or exactly the sub-voxel box (the rest is kept). */
function eraseBox(state: AppState, coord: Coord, box: CellBox) {
  if (isWholeBox(box)) {
    applyEraseCell(state, coord)
    return
  }
  writeBox(state.model, coord, box, null)
  markDirty(state)
}

/** Recolor write at one box (never adds, deletes, or reshapes). Returns whether anything changed. */
function recolorAt(state: AppState, coord: Coord, box: CellBox, slot: PaletteSlotRef): boolean {
  if (!recolorBox(state.model, coord, box, slot)) return false
  markDirty(state)
  return true
}

/**
 * Shape-kind paint into a sub-voxel box — the detail analogue of `applyPaintCell`'s shape
 * branches. A re-click on a family bevel that exactly occupies the box cycles it (rotate, then
 * advance the family once a full turn completes); otherwise ramp/wedge classify the box's own
 * subcell neighborhood (`sampleBoxNeighborhood`, which reads children in adjacent voxels) and
 * every other kind freezes verbatim at the brush rotation. `writeBox` places the bevel — or a
 * plain block when the voxel is cut finer than the box. Unclassifiable ramps (null shape) and
 * wedge fallbacks register for the in-stroke retry, exactly like unit scale.
 */
function paintDetailBevel(
  state: AppState,
  plane: ConstructionPlane,
  coord: Coord,
  box: CellBox,
  slot: PaletteSlotRef,
  kind: Exclude<VoxelKind, 'cube'>,
  stamp: boolean,
) {
  const brush = (state.brushRotation ?? 0) as Rotation
  const parentKey = encodeKey(...coord)
  const at = exactChildIndex(state.model, coord, box)
  if (!stamp && at !== null && isBevelFamilyKind(kind) && !strokeDetailKeys?.has(`${parentKey}/${at}`)) {
    const entry = getSubdivCell(state.model, coord)!.children[at]
    const existing = entry?.chamfer?.resolvedTo
    if (entry && existing && isBevelFamilyKind(existing.shapeKind)) {
      const turned = nextBevelTurn(existing.shapeKind, existing.rotation, brush)
      writeBox(state.model, coord, box, {
        slot: entry.slot,
        chamfer: { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: turned.shapeKind, rotation: turned.rotation } },
      })
      const key = `${parentKey}/${at}`
      freshDetailKeys?.delete(key)
      pendingDetailWedgeKeys?.delete(key)
      strokeDetailKeys?.add(key)
      return
    }
  }
  const auto = kind === 'ramp' || kind === 'wedge' ? classify(sampleBoxNeighborhood(state.model, plane, coord, box)) : null
  const resolvedTo = kind === 'ramp'
    ? (auto && brush ? { ...auto, rotation: ((auto.rotation + brush) % 4) as Rotation } : auto)
    : kind === 'wedge'
      ? { shapeKind: 'wedge' as const, rotation: (((auto?.shapeKind === 'convex' ? auto.rotation : 0) + brush) % 4) as Rotation }
      : { shapeKind: kind, rotation: brush }
  writeBox(state.model, coord, box, { slot, chamfer: { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo } })
  const placed = exactChildIndex(state.model, coord, box)
  if (placed !== null) {
    const key = `${parentKey}/${placed}`
    freshDetailKeys?.delete(key)
    pendingDetailWedgeKeys?.delete(key)
    if (!stamp && kind === 'ramp' && !resolvedTo) freshDetailKeys?.add(key)
    if (!stamp && kind === 'wedge' && auto?.shapeKind !== 'convex') pendingDetailWedgeKeys?.add(key)
    strokeDetailKeys?.add(key)
  }
  if (!stamp && (kind === 'ramp' || kind === 'wedge')) retryDetailChamfers(state)
}

/**
 * In-stroke retry for detail autotile nulls and wedge fallbacks — mirrors the unit-scale
 * fresh/pending loops. Only children this stroke painted are ever re-classified (a chamfer
 * resolves only on its own edit). Keys stay valid across the stroke: a bevel's child index only
 * changes when a split cuts it, and a cut bevel becomes a plain block (dropped below).
 */
function retryDetailChamfers(state: AppState): boolean {
  const brush = (state.brushRotation ?? 0) as Rotation
  let changed = false
  const retry = (keys: Set<string> | null, upgradeWedge: boolean) => {
    if (!keys) return
    for (const key of [...keys]) {
      const slash = key.lastIndexOf('/')
      const parent = decodeKey(key.slice(0, slash) as CellKey)
      const index = Number(key.slice(slash + 1))
      const sub = getSubdivCell(state.model, parent)
      const child = sub?.children[index]
      // Erased, cut to a plain block, or folded away — nothing left to retry.
      if (!sub || !child?.chamfer || (!upgradeWedge && child.chamfer.resolvedTo)) {
        keys.delete(key)
        continue
      }
      const rt = classify(sampleBoxNeighborhood(state.model, { axis: child.chamfer.planeAxis }, parent, childBox(sub.split, index)))
      if (upgradeWedge) {
        // Wedges only upgrade: take the true corner once the stroke completes it.
        if (rt?.shapeKind === 'convex') {
          child.chamfer.resolvedTo = { shapeKind: 'wedge', rotation: ((rt.rotation + brush) % 4) as Rotation }
          keys.delete(key)
          changed = true
        }
      } else if (rt) {
        child.chamfer.resolvedTo = brush ? { ...rt, rotation: ((rt.rotation + brush) % 4) as Rotation } : rt
        keys.delete(key)
        changed = true
      }
    }
  }
  retry(freshDetailKeys, false)
  retry(pendingDetailWedgeKeys, true)
  return changed
}

export const createPaintActionsSlice: Slice = (set, get) => ({
  correctChamferStroke: () => {
    // Outside an open stroke there is nothing stroke-local to correct (all tracking sets are
    // only non-null between beginStroke/commitStroke).
    if (!freshChamferKeys && !pendingWedgeKeys && !freshDetailKeys && !pendingDetailWedgeKeys) return
    // The manual brush rotation (R key) is additive on every fresh paint, so the correction
    // pass must re-apply it to its fresh verdicts — otherwise it silently un-rotates the shape
    // the ghost/HUD preview promised.
    const strokeBrush = (get().brushRotation ?? 0) as Rotation
    const withBrush = <T extends { rotation: Rotation }>(rt: T | null): T | null =>
      rt && strokeBrush ? { ...rt, rotation: ((rt.rotation + strokeBrush) % 4) as Rotation } : rt
    let changed = false
    set((state) => {
      if (freshChamferKeys) {
        for (const freshKey of freshChamferKeys) {
          const cell = state.model.chamfer.get(freshKey)
          if (!cell) continue
          // Each cell carries its own authoring basis, so multi-plane strokes correct every
          // cell in its own frame (not just the currently active plane).
          const coord = decodeKey(freshKey)
          const cellPlane: ConstructionPlane = {
            axis: cell.planeAxis,
            orientation: cell.planeOrientation,
            offset: coord[axisIndex(cell.planeAxis)],
            half: null,
          }
          const { u: fu, v: fv } = pixelFromGridCoord(cellPlane, coord)
          const rt = withBrush(classify(sampleNeighbors(state.model, cellPlane, fu, fv)))
          // Overwrite even when already resolved: a mid-stroke verdict read partial neighbors
          // (this stroke's own later paints completed them). Still-null stays null.
          if (JSON.stringify(cell.resolvedTo) !== JSON.stringify(rt)) {
            cell.resolvedTo = rt
            changed = true
          }
        }
      }
      if (pendingWedgeKeys) {
        for (const pendingKey of pendingWedgeKeys) {
          const cell = state.model.chamfer.get(pendingKey)
          if (!cell) {
            pendingWedgeKeys.delete(pendingKey)
            continue
          }
          const coord = decodeKey(pendingKey)
          const cellPlane: ConstructionPlane = {
            axis: cell.planeAxis,
            orientation: cell.planeOrientation,
            offset: coord[axisIndex(cell.planeAxis)],
            half: null,
          }
          const { u: pu, v: pv } = pixelFromGridCoord(cellPlane, coord)
          const rt = classify(sampleNeighbors(state.model, cellPlane, pu, pv))
          // Wedges only upgrade: an unresolved fallback takes its true corner once the stroke
          // completes it, but a locked-in wedge never flips (freeze + click-to-rotate intact).
          if (rt?.shapeKind === 'convex') {
            cell.resolvedTo = { shapeKind: 'wedge', rotation: ((rt.rotation + strokeBrush) % 4) as Rotation }
            pendingWedgeKeys.delete(pendingKey)
            changed = true
          }
        }
      }
      // Detail autotile settles the same way — only the children this stroke painted (a
      // chamfer resolves only on its own edit; no slice-wide propagation).
      if (retryDetailChamfers(state)) changed = true
      if (changed) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
  },

  paintCell: (u: number, v: number, qu?: number, qv?: number) => {
    get().bakeFloatIfAny()
    const { plane, activeVoxelKind, activePaletteSlot, selection, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    // An active selection clips editing to its mask (bakeFloatIfAny above already resolved any float).
    if (selection && !isSelectedAt(selection, plane, u, v, qu, qv)) {
      get().flashSelectionBlocked()
      return false
    }
    // The grid decides the box: the hovered grid cell (quadrant-addressed in-plane, the plane's
    // slab in depth), or the whole voxel under the whole grid.
    set((state) => {
      paintBox(state, plane, coord, u, v, editBox(state, plane, qu, qv), activeVoxelKind, activePaletteSlot, false)
    })
    return true
  },

  paintCellAtCoord: (coord: Coord, faceAxis: Axis, faceOrientation: Orientation, bits?: Coord | null) => {
    get().bakeFloatIfAny()
    const { activeVoxelKind, activePaletteSlot, meta, plane } = get()
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    // The caller-supplied axis/orientation (3D taps pass the active construction plane, so
    // orientation always matches the brush preview — never the raycast face) on the target
    // cell's slice; the depth slab is the active plane's when the axes agree.
    // (Deliberately no selection clip — the 2D selection mask lives in the active plane's frame
    // and can't meaningfully clip a different face's slice.)
    const facePlane: ConstructionPlane = {
      axis: faceAxis,
      orientation: faceOrientation,
      offset: coord[axisIndex(faceAxis)],
      half: faceAxis === plane.axis ? plane.half : null,
    }
    const { u, v } = pixelFromGridCoord(facePlane, coord)
    set((state) => {
      paintBox(state, facePlane, coord, u, v, gridBox(facePlane, state.gridSplit, bits ?? null), activeVoxelKind, activePaletteSlot, false)
    })
    return true
  },

  paintLineAtCoord: (coord: Coord, extend: boolean, bits?: Coord | null) => {
    get().bakeFloatIfAny()
    const { plane, meta, paintLineAnchor } = get()
    // Every tap re-establishes the anchor — chaining for the next shift-click.
    get().setPaintLineAnchor({ coord, axis: plane.axis, orientation: plane.orientation, ...(bits ? { bits } : {}) })
    // Without a usable anchor (none yet, or the plane frame changed since) — or when the
    // target sits off the active slice (out-of-plane stacking has no in-plane line) — paint one.
    const anchorUsable = extend && paintLineAnchor !== null
      && paintLineAnchor.axis === plane.axis
      && paintLineAnchor.orientation === plane.orientation
    const onSlice = coord[axisIndex(plane.axis)] === plane.offset
    // One stroke for the whole gesture (the primitive below never brackets itself — the
    // 3D tap path brackets it instead — so bracketing here nests nothing).
    get().beginStroke()
    let ok = true
    const div = fineDivisionFor(plane, get().gridSplit)
    const fineLine = (div.su === 2 || div.sv === 2) && !!paintLineAnchor?.bits && !!bits
    if (paintLineAnchor && anchorUsable && onSlice && fineLine) {
      // Grid-resolution line: from the anchor's grid cell to the tapped one, one grid cell per
      // step along the dominant axis (half voxels on the axes the grid cuts).
      const { uA, vA, uPos, vPos } = planeFrame(plane.axis)
      const fineOf = (c: Coord, b: Coord): [number, number] => {
        const { u, v } = pixelFromGridCoord(plane, c)
        return [u * div.su + (div.su === 2 ? (uPos ? b[uA] : 1 - b[uA]) : 0), v * div.sv + (div.sv === 2 ? (vPos ? b[vA] : 1 - b[vA]) : 0)]
      }
      const a = fineOf(paintLineAnchor.coord, paintLineAnchor.bits!)
      const b = fineOf(coord, bits!)
      const kind = get().activeVoxelKind
      const slot = get().activePaletteSlot
      set((state) => {
        for (const [fu, fv] of dominantAxisLineFine(a, b, div.su, div.sv)) {
          const lu = Math.floor(fu / div.su)
          const lv = Math.floor(fv / div.sv)
          const c = gridCoordFromPixel(plane, lu, lv)
          if (!withinWorkingBounds(c, meta.gridExtent)) continue
          const box = gridBox(plane, state.gridSplit, worldBitsFromQuad(plane, fu - lu * div.su, fv - lv * div.sv))
          paintBox(state, plane, c, lu, lv, box, kind, slot, false)
        }
      })
    } else if (paintLineAnchor && anchorUsable && onSlice) {
      const a = pixelFromGridCoord(plane, paintLineAnchor.coord)
      const b = pixelFromGridCoord(plane, coord)
      const kind = get().activeVoxelKind
      const slot = get().activePaletteSlot
      set((state) => {
        // Replace-only (2D parity): every line cell overwrites, like single taps. Line cells
        // carry no pointer half, so they span the in-plane extent at the plane's slab.
        const box = gridBox(plane, state.gridSplit, null)
        for (const [lu, lv] of dominantAxisLine(a.u, a.v, b.u, b.v)) {
          const c = gridCoordFromPixel(plane, lu, lv)
          if (!withinWorkingBounds(c, meta.gridExtent)) continue
          paintBox(state, plane, c, lu, lv, box, kind, slot, false)
        }
      })
    } else {
      ok = get().paintCellAtCoord(coord, plane.axis, plane.orientation, bits)
    }
    get().commitStroke()
    return ok
  },

  eraseCell: (coord: Coord, qu?: number, qv?: number) => {
    get().bakeFloatIfAny()
    const { plane, selection } = get()
    if (selection) {
      const { u, v } = pixelFromGridCoord(plane, coord)
      if (!isSelectedAt(selection, plane, u, v, qu, qv)) {
        get().flashSelectionBlocked()
        return
      }
    }
    // The grid decides the box, exactly like paint: erase carves one grid cell.
    set((state) => {
      eraseBox(state, coord, editBox(state, plane, qu, qv))
    })
  },

  eraseCellAtCoord: (coord: Coord, bits?: Coord | null) => {
    get().bakeFloatIfAny()
    // 3D taps hand the half-bits of the clicked point: the grid cell under it is carved
    // (the whole voxel under the whole grid, or when no point is known).
    set((state) => {
      eraseBox(state, coord, bits ? gridBoxAtBits(state.gridSplit, bits) : WHOLE_BOX)
    })
  },

  fillSelection: () => {
    get().bakeFloatIfAny()
    const { plane, activeVoxelKind, activePaletteSlot, selectedCells, selection, meta } = get()
    const kind = activeVoxelKind
    const slot = activePaletteSlot
    // Sub-voxel selections fill exactly their fine cells: cubes through the selection's own
    // write (whole chamfer cells recolor atomically), shapes stamp each fine cell's box.
    const fine3D = liveFineSelection3D(get())
    const fineRegion = fine3D ? fine3D : selection?.fine && selectedCells.size === 0 ? { region: selection, plane } : null
    if (fineRegion) {
      get().beginStroke()
      set((state) => {
        if (kind === 'cube') {
          paintFineRegion(state.model, fineRegion.plane, fineRegion.region, slot)
          return
        }
        forEachFineCell(fineRegion.region, (fu, fv) => {
          const { coord, box } = fineCellBox(fineRegion.plane, fineRegion.region, fu, fv)
          if (!withinWorkingBounds(coord, meta.gridExtent)) return
          // Whole chamfer cells are atomic in a selection: a touched one restamps whole.
          const atomic = state.model.chamfer.has(encodeKey(...coord))
          const { u, v } = pixelFromGridCoord(fineRegion.plane, coord)
          paintBox(state, fineRegion.plane, coord, u, v, atomic ? WHOLE_BOX : box, kind, slot, true)
        })
      })
      get().commitStroke()
      return
    }
    const coords: Coord[] = []
    if (selectedCells.size > 0) {
      for (const key of selectedCells) {
        const coord = decodeKey(key)
        if (!withinWorkingBounds(coord, meta.gridExtent)) continue
        coords.push(coord)
      }
    } else if (selection) {
      forEachSelectedCell(selection, (u, v) => {
        const coord = gridCoordFromPixel(plane, u, v)
        if (!withinWorkingBounds(coord, meta.gridExtent)) return
        coords.push(coord)
      })
    } else return
    if (coords.length === 0) return
    get().beginStroke()
    // Whole-cell selections fill at the grid's depth: every cell's full in-plane extent, at the
    // plane's slab when the grid cuts the plane axis (whole voxels under the whole grid).
    set((state) => {
      const box = gridBox(plane, state.gridSplit, null)
      for (const coord of coords) {
        const { u, v } = pixelFromGridCoord(plane, coord)
        paintBox(state, plane, coord, u, v, box, kind, slot, true)
      }
    })
    get().commitStroke()
  },

  paintMaterialCell: (u: number, v: number, qu?: number, qv?: number) => {
    get().bakeFloatIfAny()
    const { plane, activePaletteSlot, selection, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    if (selection && !isSelectedAt(selection, plane, u, v, qu, qv)) {
      get().flashSelectionBlocked()
      return false
    }
    let changed = false
    set((state) => {
      changed = recolorAt(state, coord, editBox(state, plane, qu, qv), activePaletteSlot)
    })
    return changed
  },

  paintMaterialAtCoord: (coord: Coord, bits?: Coord | null) => {
    get().bakeFloatIfAny()
    const { activePaletteSlot, meta } = get()
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    let changed = false
    set((state) => {
      changed = recolorAt(state, coord, bits ? gridBoxAtBits(state.gridSplit, bits) : WHOLE_BOX, activePaletteSlot)
    })
    return changed
  },

  rebaseRampCell: (u: number, v: number) => {
    get().bakeFloatIfAny()
    const { plane, selection, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    if (selection && !isCellSelected(selection, u, v)) {
      get().flashSelectionBlocked()
      return false
    }
    let changed = false
    set((state) => {
      const key = encodeKey(...coord)
      const cell = state.model.chamfer.get(key)
      const kind = cell?.resolvedTo?.shapeKind
      // Thin slabs flip orientation on their own axis: the centered slab is mirror-symmetric,
      // so the solid is identical and only the sampled texture face switches. A cross-axis
      // facing would rotate the slab (a geometry edit) and is refused.
      if (kind === 'thin') {
        if (cell!.planeAxis !== plane.axis || cell!.planeOrientation === plane.orientation) return
        cell!.planeOrientation = plane.orientation
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
        changed = true
        return
      }
      // Ramps and wedges are congruent prisms — both rebase onto a ramp basis reproducing the
      // exact solid (a wedge source converts shapeKind, since its dual is always a ramp).
      if (kind !== 'ramp' && kind !== 'wedge') return
      const rotation = kind === 'ramp'
        ? findDualRampRotation(cell!, plane.axis, plane.orientation)
        : findWedgeRampDual(cell!, plane.axis, plane.orientation)
      if (rotation === null) return
      if (kind === 'ramp' && rotation === cell!.resolvedTo!.rotation && cell!.planeAxis === plane.axis && cell!.planeOrientation === plane.orientation) return
      cell!.planeAxis = plane.axis
      cell!.planeOrientation = plane.orientation
      cell!.resolvedTo = { shapeKind: 'ramp', rotation }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
      changed = true
    })
    return changed
  },
})
