import type { StateCreator } from 'zustand'
import { decodeKey, encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { childInSlab, ensureSplitForPaint, eraseSubCell, frontSlabBit, getSubdivCell, isSubdivided, isValidSubCellIndex, paintSubCell, quadrantSubcells, sampleDetailNeighborhood, writeSubCell } from '@/engine/grid/subdiv'
import type { Axis, CellKey, Coord, Orientation, Rotation } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { classify, resolveDetailChamferCellsOnPlane, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { spinSlabAboutLocalY } from '@/engine/chamfer/chamferTransform'
import { findDualRampRotation, findWedgeRampDual } from '@/engine/chamfer/rampDual'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { showToast } from '@/components/ui/toastBus'
import { dominantAxisLine } from '@/engine/tools/lineUtils'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { isCellSelected, forEachSelectedCell } from '@/engine/tools/selectionMask'
import { isSelectedAt } from '@/engine/tools/fineSelection'
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
 * Grid-aware paint write: when a grid division is armed and the cell isn't subdivided
 * yet, it splits just-in-time (plain → subdivide, empty → scaffold, chamfered bevel
 * cleared first) and the write lands on detail; otherwise the write goes through the
 * unchanged whole-voxel path. Callers run this inside their own set() producer so
 * split+paint share one undo stroke. Returns false only when the JIT split fails.
 */
function paintWithGridSplit(
  state: AppState,
  plane: ConstructionPlane,
  coord: Coord,
  u: number,
  v: number,
  qu: number | undefined,
  qv: number | undefined,
  kind: VoxelKind,
  slot: PaletteSlotRef,
  stamp: boolean,
): boolean {
  const key = encodeKey(...coord)
  const gridSplit = state.pendingSplit
  if (gridSplit && !state.model.subdiv.has(key)) {
    if (!ensureSplitForPaint(state.model, coord, gridSplit, slot)) return false
  }
  if (state.model.subdiv.has(key)) {
    const brush = (state.brushRotation ?? 0) as Rotation
    return kind === 'cube'
      ? paintDetailQuadrants(state, plane, coord, qu, qv, slot)
      : stampDetailShape(state, plane, coord, qu, qv, slot, kind, brush)
  }
  applyPaintCell(state, coord, u, v, plane, kind, slot, stamp)
  return true
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
  // Half-step planes only admit subdivided voxels (per-child path): a whole cube would
  // straddle the slab. Fail closed like the subdivided-parent guard below; call sites
  // toast as appropriate (discrete taps) or stay silent (drag sweeps).
  if (state.plane.half !== null) return
  // Fail closed on subdivided parents: detail cells are painted per-octant through
  // paintSubCellAtCoord, never through the full-cell path (which would leave a color cell
  // and a subdiv entry fighting over the same footprint). Callers toast as appropriate.
  if (state.model.subdiv.has(key)) return
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

/** Shared erase write (both layers, no selection concept) — `eraseCell` clips first, 3D skips it. Also clears a subdiv entry outright. */
function applyEraseCell(state: AppState, coord: Coord) {
  // Half-step planes never clear whole footprints (a subdiv entry spans both slabs).
  // Detail erases route per-child through eraseDetailQuadrants/eraseSubCellAtCoord instead.
  if (state.plane.half !== null) return
  const key = encodeKey(...coord)
  state.model.color.delete(key)
  state.model.chamfer.delete(key)
  state.model.subdiv.delete(key)
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
}

/**
 * Stamps one 2D quadrant of a subdivided parent: the viewer-side (front) child of the
 * quadrant's set (see subdiv.ts's `quadrantSubcells` — a tap never edits two subvoxels at
 * once; the back half is reachable by half-stepping the plane). A null quadrant stamps the
 * front slab of the whole entry — the shift-line/synthetic-event path, which carries no
 * continuous pointer position.
 */
function paintDetailQuadrants(
  state: AppState,
  plane: ConstructionPlane,
  parent: Coord,
  qu: number | undefined,
  qv: number | undefined,
  slot: PaletteSlotRef,
): boolean {
  const sub = getSubdivCell(state.model, parent)
  if (!sub) return false
  const indices = (qu === undefined || qv === undefined
    ? sub.children.map((_, i) => i)
    : quadrantSubcells(plane.axis, plane.orientation, sub.split, qu, qv)
  // Paint lands on one editable slab: the explicit half-step slab, else the viewer-side
  // (front) slab in whole-voxel mode — a tap never edits two subvoxels at once.
  ).filter((o) => childInSlab(sub.split, plane.axis, plane.half ?? frontSlabBit(plane.orientation), o))
  let changed = false
  for (const o of indices) {
    // Nulls fill in place (holes repaint, scaffolds take paint) — paintSubCell creates.
    paintSubCell(state.model, parent, o, slot)
    changed = true
  }
  if (!changed) return false
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
  return true
}

/**
 * Re-click cycle for one detail child, shared by the 2D stamp and 3D tap paths: when the
 * armed kind and the child's existing shape are both in the bevel family, rotate (advancing
 * the family once a full turn completes) instead of re-resolving — no neighbor sampling.
 * Drag revisits (touched this stroke) fall through to fresh writes so sweeps never advance
 * what they just painted. Returns true when it cycled (caller skips its normal write).
 */
function cycleDetailChamfer(
  state: AppState,
  plane: ConstructionPlane,
  parent: Coord,
  index: number,
  kind: VoxelKind,
  brush: Rotation,
): boolean {
  if (kind !== 'ramp' && kind !== 'convex' && kind !== 'concave' && kind !== 'wedge') return false
  const sub = getSubdivCell(state.model, parent)
  if (!sub || !isValidSubCellIndex(sub, index)) return false
  const key = `${encodeKey(...parent)}/${index}`
  if (strokeDetailKeys?.has(key)) return false
  const entry = sub.children[index]
  const existing = entry?.chamfer?.resolvedTo
  if (!entry || !existing || !isBevelFamilyKind(existing.shapeKind)) return false
  const turned = nextBevelTurn(existing.shapeKind, existing.rotation, brush)
  writeSubCell(state.model, parent, index, {
    slot: entry.slot,
    chamfer: { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: turned.shapeKind, rotation: turned.rotation } },
  })
  freshDetailKeys?.delete(key)
  pendingDetailWedgeKeys?.delete(key)
  strokeDetailKeys?.add(key)
  return true
}

/**
 * Auto-bevel write for one detail child — the detail analogue of `applyPaintCell`'s
 * ramp/wedge branches. Classifies the child's own subcell neighborhood (which reads live
 * children in adjacent subdivided parents, not just unit voxels) and stores a frozen
 * shape: ramp takes whatever the neighbors say (ramp/convex/concave) plus the brush
 * offset, wedge locks its shape with a convex-derived rotation or the rotation-0 fallback.
 * Unclassifiable ramps store a null `resolvedTo` (rendered as a cube until neighbors
 * complete them) and register for stroke retry; wedge fallbacks register for the corner
 * upgrade. Returns false for non-autotile kinds — callers freeze those verbatim.
 * Operates on the immer draft, like the other apply/write helpers.
 */
function autoDetailChamfer(
  state: AppState,
  plane: ConstructionPlane,
  parent: Coord,
  index: number,
  slot: PaletteSlotRef,
  kind: 'ramp' | 'wedge',
  brush: Rotation,
): boolean {
  const sub = getSubdivCell(state.model, parent)
  if (!sub || !isValidSubCellIndex(sub, index)) return false
  const auto = classify(sampleDetailNeighborhood(state.model, plane, parent, index))
  const key = `${encodeKey(...parent)}/${index}`
  if (kind === 'ramp') {
    // A fresh ramp verdict ends any wedge-pending lifecycle on this child (the retry
    // paths write unconditionally on a convex find, so stale keys would corrupt).
    pendingDetailWedgeKeys?.delete(key)
    const resolvedTo = auto && brush ? { ...auto, rotation: ((auto.rotation + brush) % 4) as Rotation } : auto
    writeSubCell(state.model, parent, index, {
      slot,
      chamfer: { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo },
    })
    if (!resolvedTo && freshDetailKeys) freshDetailKeys.add(key)
  } else {
    // Symmetrically, a wedge verdict ends ramp-pending (the fresh retry writes ramps
    // unconditionally on classify).
    freshDetailKeys?.delete(key)
    const rotation = (((auto?.shapeKind === 'convex' ? auto.rotation : 0) + brush) % 4) as Rotation
    writeSubCell(state.model, parent, index, {
      slot,
      chamfer: { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: 'wedge', rotation } },
    })
    if (auto?.shapeKind === 'convex') pendingDetailWedgeKeys?.delete(key)
    else if (pendingDetailWedgeKeys) pendingDetailWedgeKeys.add(key)
  }
  strokeDetailKeys?.add(key)
  return true
}

/**
 * In-stroke retry for detail autotile nulls and wedge fallbacks — mirrors the unit-scale
 * fresh/pending loops. Re-classifies each tracked child against the current model (later
 * paints in the same stroke are visible) on its authoring basis, applying the stroke brush
 * so the promised rotation survives. Operates on the immer draft. Returns whether anything
 * resolved.
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
      if (!child?.chamfer) {
        // Erased (or the entry coarsened away) — nothing left to retry.
        keys.delete(key)
        continue
      }
      // Pending keys always hold unresolved autotile paints by construction (every
      // resolving write — ramp, wedge-lock, or verbatim — removes its key), so a set
      // resolvedTo here is a wedge fallback awaiting its corner, never a finished shape.
      if (!upgradeWedge && child.chamfer.resolvedTo) {
        keys.delete(key)
        continue
      }
      // Pending keys always hold null-resolvedTo autotile paints by construction (every
      // resolving write — ramp, wedge-lock, or verbatim — removes its key), so the
      // wedge branch below needs no shape guard.
      const cellPlane: ConstructionPlane = {
        axis: child.chamfer.planeAxis,
        orientation: child.chamfer.planeOrientation,
        offset: parent[axisIndex(child.chamfer.planeAxis)],
        half: null,
      }
      const rt = classify(sampleDetailNeighborhood(state.model, cellPlane, parent, index))
      if (upgradeWedge) {
        // Wedges only upgrade: take the true corner once the stroke completes it, never
        // flip a locked-in wedge (freeze intact — same as unit-scale).
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

/**
 * Stamps one 2D quadrant of a subdivided parent: the viewer-side (front) children of the
 * quadrant's set, each auto-beveled from its own subcell neighborhood for the ramp/wedge
 * kinds (frozen verbatim kind + brush rotation for every other kind). A null quadrant
 * stamps the front slab of the whole entry — the shift-line/synthetic-event path, which
 * carries no continuous pointer position.
 */
function stampDetailShape(
  state: AppState,
  plane: ConstructionPlane,
  parent: Coord,
  qu: number | undefined,
  qv: number | undefined,
  slot: PaletteSlotRef,
  kind: Exclude<VoxelKind, 'cube'>,
  brush: Rotation,
): boolean {
  const sub = getSubdivCell(state.model, parent)
  if (!sub) return false
  const indices = (qu === undefined || qv === undefined
    ? sub.children.map((_, i) => i)
    : quadrantSubcells(plane.axis, plane.orientation, sub.split, qu, qv)
  // Paint lands on one editable slab: the explicit half-step slab, else the viewer-side
  // (front) slab in whole-voxel mode — a tap never edits two subvoxels at once.
  ).filter((o) => childInSlab(sub.split, plane.axis, plane.half ?? frontSlabBit(plane.orientation), o))
  let changed = false
  for (const o of indices) {
    // Re-clicks on family bevels cycle (rotate, then advance the family) instead of
    // re-resolving; every other stamp writes through (drag revisits re-stamp idempotently).
    if (cycleDetailChamfer(state, plane, parent, o, kind, brush)) {
      changed = true
      continue
    }
    if (kind === 'ramp' || kind === 'wedge') {
      // Nulls fill in place (holes take new shapes, scaffolds take paint).
      if (!autoDetailChamfer(state, plane, parent, o, slot, kind, brush)) continue
    } else {
      // Verbatim explicit shapes end any autotile-pending lifecycle on these children.
      const key = `${encodeKey(...parent)}/${o}`
      freshDetailKeys?.delete(key)
      pendingDetailWedgeKeys?.delete(key)
      // Nulls fill in place (holes take new shapes, scaffolds take paint).
      writeSubCell(state.model, parent, o, {
        slot,
        chamfer: {
          planeAxis: plane.axis,
          planeOrientation: plane.orientation,
          resolvedTo: { shapeKind: kind, rotation: brush },
        },
      })
    }
    changed = true
  }
  if (kind === 'ramp' || kind === 'wedge') retryDetailChamfers(state)
  if (!changed) return false
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
  return true
}

/** Quadrant erase: nulls the set's (or whole entry's) children; all-null deletes the entry. */
function eraseDetailQuadrants(
  state: AppState,
  plane: ConstructionPlane,
  parent: Coord,
  qu: number | undefined,
  qv: number | undefined,
): boolean {
  const sub = getSubdivCell(state.model, parent)
  if (!sub) return false
  const indices = (qu === undefined || qv === undefined
    ? sub.children.map((_, i) => i)
    : quadrantSubcells(plane.axis, plane.orientation, sub.split, qu, qv)
  // Erase keeps the full depth set (front and back clear together); half-step clips to
  // the active slab — the rest of the footprint isn't editable.
  ).filter((o) => childInSlab(sub.split, plane.axis, plane.half, o))
  // Content-only erase: the subdivision survives losing its children so it can be
  // repainted (scaffolds work the same way). Only an already-empty voxel clears.
  const wasEmpty = sub.children.every((c) => c === null)
  let changed = false
  for (const o of indices) {
    if (sub.children[o] === null) continue
    sub.children[o] = null
    changed = true
  }
  if (wasEmpty) {
    state.model.subdiv.delete(encodeKey(...parent))
    changed = true
  }
  if (!changed) return false
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
  return true
}

/** Quadrant recolor: rewrites the set's live children, skipping matches (chamfers preserved). */
function recolorDetailQuadrants(
  state: AppState,
  plane: ConstructionPlane,
  parent: Coord,
  qu: number | undefined,
  qv: number | undefined,
  slot: PaletteSlotRef,
): boolean {
  const sub = getSubdivCell(state.model, parent)
  if (!sub) return false
  const indices = (qu === undefined || qv === undefined
    ? sub.children.map((_, i) => i)
    : quadrantSubcells(plane.axis, plane.orientation, sub.split, qu, qv)
  // Paint lands on one editable slab: the explicit half-step slab, else the viewer-side
  // Material keeps the full depth set (front and back recolor together); half-step clips
  // to the active slab — the rest of the footprint isn't editable.
  ).filter((o) => childInSlab(sub.split, plane.axis, plane.half, o))
  let changed = false
  for (const o of indices) {
    const child = sub.children[o]
    if (child === null || (child.slot.kind === slot.kind && child.slot.index === slot.index)) continue
    sub.children[o] = { ...child, slot }
    changed = true
  }
  if (!changed) return false
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
  return true
}

/**
 * Recolor write: swaps the palette slot on an existing voxel, nothing else. Returns false (and
 * writes nothing, so the enclosing stroke stays a no-op) on empty cells and same-slot repaints.
 * On a subdivided parent, recolors every live child instead (the material tool addresses
 * whole parents in 2D; per-child recolor lives in the 3D tap path). Child chamfers are preserved.
 */
function applyMaterialCell(state: AppState, coord: Coord, slot: PaletteSlotRef): boolean {
  const key = encodeKey(...coord)
  const sub = getSubdivCell(state.model, coord)
  if (sub) {
    let changed = false
    for (let i = 0; i < sub.children.length; i++) {
      // Half-step recolors only the active slab (the rest is out of the edit target).
      if (!childInSlab(sub.split, state.plane.axis, state.plane.half, i)) continue
      const child = sub.children[i]
      if (child === null || (child.slot.kind === slot.kind && child.slot.index === slot.index)) continue
      sub.children[i] = { ...child, slot }
      changed = true
    }
    if (!changed) return false
    state.meta.modifiedAt = new Date().toISOString()
    state.dirty = true
    return true
  }
  // Whole-cell recolor would straddle the slab — half-step admits subdivided only.
  if (state.plane.half !== null) return false
  const existing = state.model.color.get(key)
  if (!existing) return false
  if (existing.paletteSlot.kind === slot.kind && existing.paletteSlot.index === slot.index) return false
  state.model.color.set(key, { paletteSlot: slot })
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
  return true
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
      // Detail autotile settles the same way: stroke-local nulls/fallbacks retry with the
      // brush, then the slice pass fills whatever the stroke completed (brush-less — that
      // promise belonged to the stroke that made each paint). Covers ramps stamped before
      // their neighbors existed, in this stroke or an earlier one.
      if (retryDetailChamfers(state)) changed = true
      if (resolveDetailChamferCellsOnPlane(state.model, get().plane)) changed = true
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
    // Grid-aware write: an armed grid division splits fresh cells just-in-time and the
    // paint lands on detail (quadrant-addressed for subdivided parents, front slab for
    // fresh splits); whole grid paints unit voxels as before. Detail is quadrant-addressed:
    // paint stamps the hovered set (a depth pair for 8-splits, fewer for partial splits),
    // or the whole entry when the gesture carries no continuous position (shift-lines,
    // synthetic events). Ramp/wedge kinds auto-bevel from the subcell neighborhood; every
    // other chamfer kind writes frozen explicit shapes (scaled to fill at render/export).
    const kind = activeVoxelKind
    let ok = false
    set((state) => {
      ok = paintWithGridSplit(state, plane, coord, u, v, qu, qv, kind, activePaletteSlot, false)
    })
    return ok
  },

  paintCellAtCoord: (coord: Coord, faceAxis: Axis, faceOrientation: Orientation) => {
    get().bakeFloatIfAny()
    const { activeVoxelKind, activePaletteSlot, meta } = get()
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    // Already-subdivided parents never take the full-cell path: taps route per-octant
    // through paintSubCellAtCoord in Viewport3D (which ensures the split first for fresh
    // cells, preserving hovered-child precision). Fresh cells split just-in-time here and
    // paint the front slab. Chamfer kinds can't address half-cells — silent, since touch
    // drags pass through here per move.
    if (isSubdivided(get().model, coord)) return false
    // The caller-supplied axis/orientation (3D taps pass the active construction plane, so
    // orientation always matches the brush preview — never the raycast face) on the target
    // cell's slice.
    // (Deliberately no selection clip — the 2D selection mask lives in the active plane's frame
    // and can't meaningfully clip a different face's slice.)
    const facePlane: ConstructionPlane = { axis: faceAxis, orientation: faceOrientation, offset: coord[axisIndex(faceAxis)], half: null }
    const { u, v } = pixelFromGridCoord(facePlane, coord)
    const kind = activeVoxelKind
    let ok = false
    set((state) => {
      ok = paintWithGridSplit(state, facePlane, coord, u, v, undefined, undefined, kind, activePaletteSlot, false)
    })
    return ok
  },

  paintLineAtCoord: (coord: Coord, extend: boolean) => {
    get().bakeFloatIfAny()
    const { plane, meta, paintLineAnchor } = get()
    // Every tap re-establishes the anchor — chaining for the next shift-click.
    get().setPaintLineAnchor({ coord, axis: plane.axis, orientation: plane.orientation })
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
    if (paintLineAnchor && anchorUsable && onSlice) {
      const a = pixelFromGridCoord(plane, paintLineAnchor.coord)
      const b = pixelFromGridCoord(plane, coord)
      const kind = get().activeVoxelKind
      const slot = get().activePaletteSlot
      set((state) => {
        for (const [lu, lv] of dominantAxisLine(a.u, a.v, b.u, b.v)) {
          const c = gridCoordFromPixel(plane, lu, lv)
          if (!withinWorkingBounds(c, meta.gridExtent)) continue
          // Replace-only (2D parity): every line cell overwrites, like single taps —
          // splitting just-in-time to the armed grid like they do.
          if (!paintWithGridSplit(state, plane, c, lu, lv, undefined, undefined, kind, slot, false)) ok = false
        }
      })
    } else {
      ok = get().paintCellAtCoord(coord, plane.axis, plane.orientation)
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
    // Detail erases per quadrant set, or the whole entry with no quadrant.
    if (isSubdivided(get().model, coord)) {
        set((state) => {
        eraseDetailQuadrants(state, plane, coord, qu, qv)
      })
      return
    }
    set((state) => {
      applyEraseCell(state, coord)
    })
  },

  eraseCellAtCoord: (coord: Coord) => {
    get().bakeFloatIfAny()
    set((state) => {
      applyEraseCell(state, coord)
    })
  },

  ensureSubdividedAt: (coord: Coord) => {
    get().bakeFloatIfAny()
    const { pendingSplit, activePaletteSlot, meta } = get()
    // No grid armed (whole mode) or out of bounds: nothing to ensure.
    if (!pendingSplit || !withinWorkingBounds(coord, meta.gridExtent)) return false
    let ok = false
    set((state) => {
      // Joins the caller's open stroke (no bracketing here) — Viewport3D brackets the
      // ensure together with the per-child paint that follows, so split+paint undo as one.
      ok = ensureSplitForPaint(state.model, coord, pendingSplit, activePaletteSlot)
      if (ok) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
    return ok
  },

  paintSubCellAtCoord: (parent: Coord, index: number) => {
    get().bakeFloatIfAny()
    const { activeVoxelKind, activePaletteSlot, meta, plane } = get()
    if (!withinWorkingBounds(parent, meta.gridExtent)) return false
    const sub = getSubdivCell(get().model, parent)
    if (!sub || !isValidSubCellIndex(sub, index)) return false
    // Half-step dwells on one slab of the active slice: off-slice parents and out-of-slab
    // children refuse. The 2D quadrant paths clip the same way via childInSlab filtering.
    if (plane.half !== null) {
      if (parent[axisIndex(plane.axis)] !== plane.offset) return false
      if (!childInSlab(sub.split, plane.axis, plane.half, index)) return false
    }
    const brush = (get().brushRotation ?? 0) as Rotation
    const kind = activeVoxelKind
    let ok = false
    set((state) => {
      // Chamfer autotile kinds resolve from the child's own subcell neighborhood (which
      // reads adjacent subdivided voxels); re-clicks on family bevels cycle instead
      // (rotate, then advance the family). Every other kind writes frozen verbatim.
      if (kind === 'cube') {
        ok = paintSubCell(state.model, parent, index, activePaletteSlot)
      } else if (cycleDetailChamfer(state, state.plane, parent, index, kind, brush)) {
        ok = true
      } else if (kind === 'ramp' || kind === 'wedge') {
        ok = autoDetailChamfer(state, state.plane, parent, index, activePaletteSlot, kind, brush)
        if (ok) retryDetailChamfers(state)
      } else {
        ok = writeSubCell(state.model, parent, index, {
          slot: activePaletteSlot,
          chamfer: {
            planeAxis: state.plane.axis,
            planeOrientation: state.plane.orientation,
            resolvedTo: { shapeKind: kind, rotation: brush },
          },
        })
      }
      if (ok) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
    return ok
  },

  eraseSubCellAtCoord: (parent: Coord, index: number) => {
    get().bakeFloatIfAny()
    if (!withinWorkingBounds(parent, get().meta.gridExtent)) return
    const { plane } = get()
    if (plane.half !== null) {
      if (parent[axisIndex(plane.axis)] !== plane.offset) return
      const sub = getSubdivCell(get().model, parent)
      if (!sub || !childInSlab(sub.split, plane.axis, plane.half, index)) return
    }
    set((state) => {
      const sub = getSubdivCell(state.model, parent)
      if (!sub || !isValidSubCellIndex(sub, index)) return
      if (sub.children.every((c) => c === null)) {
        // Erasing an already-empty voxel clears the subdivision (content erases keep it).
        state.model.subdiv.delete(encodeKey(...parent))
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
        return
      }
      if (eraseSubCell(state.model, parent, index)) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
  },

  paintMaterialSubCellAtCoord: (parent: Coord, index: number) => {
    get().bakeFloatIfAny()
    const { activePaletteSlot, meta, plane } = get()
    if (!withinWorkingBounds(parent, meta.gridExtent)) return false
    const sub = getSubdivCell(get().model, parent)
    if (!sub || !isValidSubCellIndex(sub, index)) return false
    if (plane.half !== null) {
      if (parent[axisIndex(plane.axis)] !== plane.offset) return false
      if (!childInSlab(sub.split, plane.axis, plane.half, index)) return false
    }
    let changed = false
    set((state) => {
      const sub = getSubdivCell(state.model, parent)
      const child = sub?.children[index]
      if (!child) return
      if (child.slot.kind === activePaletteSlot.kind && child.slot.index === activePaletteSlot.index) return
      sub!.children[index] = { ...child, slot: activePaletteSlot }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
      changed = true
    })
    return changed
  },

  fillSelection: () => {
    get().bakeFloatIfAny()
    const { plane, activeVoxelKind, activePaletteSlot, selectedCells, selection, meta } = get()
    const fine3D = liveFineSelection3D(get())
    if (fine3D && activeVoxelKind === 'cube') {
      get().beginStroke()
      set((state) => { paintFineRegion(state.model, fine3D.plane, fine3D.region, activePaletteSlot) })
      get().commitStroke()
      return
    }
    // A sub-voxel selection fills exactly its fine cells (cube semantics), whatever the slab.
    if (selection?.fine && selectedCells.size === 0 && activeVoxelKind === 'cube') {
      get().beginStroke()
      set((state) => { paintFineRegion(state.model, state.plane, selection, activePaletteSlot) })
      get().commitStroke()
      return
    }
    // Selection fill stamps whole cubes — refused on half-step unless the grid is cutting the
    // plane's axis (then it splits and fills like any grid paint).
    if (plane.half !== null && !get().pendingSplit) {
      showToast('Half-step: only subdivided voxels are editable')
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
    // Fills arm the grid too: every target splits to the armed division just-in-time
    // (bulk — one division for the whole fill, never per-cell cycling), then stamps
    // kind-aware detail (cube fills every child) instead of skipping subdivided cells.
    const kind = activeVoxelKind
    const slot = activePaletteSlot
    set((state) => {
      for (const coord of coords) {
        const { u, v } = pixelFromGridCoord(plane, coord)
        paintWithGridSplit(state, plane, coord, u, v, undefined, undefined, kind, slot, true)
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
    // Detail recolors per quadrant set, or the whole entry with no quadrant.
    if (isSubdivided(get().model, coord)) {
        let changed = false
      set((state) => {
        changed = recolorDetailQuadrants(state, plane, coord, qu, qv, activePaletteSlot)
      })
      return changed
    }
    let changed = false
    set((state) => {
      changed = applyMaterialCell(state, coord, activePaletteSlot)
    })
    return changed
  },

  paintMaterialAtCoord: (coord: Coord) => {
    get().bakeFloatIfAny()
    const { activePaletteSlot, meta } = get()
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    let changed = false
    set((state) => {
      changed = applyMaterialCell(state, coord, activePaletteSlot)
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
