import type { StateCreator } from 'zustand'
import { decodeKey, encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Axis, Coord, Orientation, Rotation } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { classify, sampleNeighbors } from '@/engine/chamfer/chamferResolver'
import { spinSlabAboutLocalY } from '@/engine/chamfer/chamferTransform'
import { findDualRampRotation, findWedgeRampDual } from '@/engine/chamfer/rampDual'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { dominantAxisLine } from '@/engine/tools/lineUtils'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { isCellSelected, forEachSelectedCell } from '@/engine/tools/selectionMask'
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

export function beginFreshChamferTracking() {
  freshChamferKeys = new Set()
  pendingWedgeKeys = new Set()
  strokeSlabKeys = new Set()
}

export function endFreshChamferTracking() {
  freshChamferKeys = null
  pendingWedgeKeys = null
  strokeSlabKeys = null
}

/**
 * The paint-cell write itself, parameterized by an explicit plane instead of the store's active
 * one. `paintCell` (2D) passes `get().plane` plus its selection clip; `paintCellAtCoord` (3D
 * direct blocking) passes the active construction plane at the target's slice. One
 * implementation, so chamfer classification, wedge retry, and tracking behave identically from
 * either view.
 *
 * `stamp` switches from click semantics to fill semantics: every cell lands the brush shape
 * deterministically (fresh classification at the brush rotation, verbatim in 3D-only) instead
 * of applying re-click rotation/spin/cycle to already-matching cells — bulk-filling a window
 * must stamp, never spin what it just wrote. Tracking sets are left alone in stamp mode.
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
  state.model.color.set(key, { paletteSlot: slot })
  state.model.bounds = expandBounds(state.model.bounds, coord)
  // Manual brush rotation (R key / preview button): an additive quarter-turn offset applied to
  // orientable kinds at paint time. 0 preserves legacy behavior exactly (pure autotile / fresh-0).
  const brush = (state.brushRotation ?? 0) as Rotation
  // 3D-only mode is verbatim: no adjacency classification and no end-of-stroke correction —
  // what the brush preview shows is exactly what the click writes.
  const verbatim = state.layoutMode === '3d-only'

  if (kind === 'ramp') {
    const resolvedTo = verbatim
      ? { shapeKind: 'ramp' as const, rotation: brush }
      : classify(sampleNeighbors(state.model, plane, u, v))
    if (!verbatim && resolvedTo && brush) resolvedTo.rotation = ((resolvedTo.rotation + brush) % 4) as Rotation
    state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo })

    if (!stamp && !verbatim && freshChamferKeys) {
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
    const alreadyFinalized = !stamp && existing?.resolvedTo?.shapeKind === 'wedge' && !pendingWedgeKeys?.has(key)

    if (alreadyFinalized) {
      // Re-clicking a wedge that's already locked in (this stroke or a prior one) manually
      // rotates it 90° — the escape hatch for configs that never auto-resolve.
      const rotation = ((existing!.resolvedTo!.rotation + 1) % 4) as Rotation
      existing!.resolvedTo = { shapeKind: 'wedge', rotation }
    } else {
      const resolved = verbatim ? null : classify(sampleNeighbors(state.model, plane, u, v))
      const rotation = (((resolved?.shapeKind === 'convex' ? resolved.rotation : 0) + brush) % 4) as Rotation
      state.model.chamfer.set(key, { planeAxis: plane.axis, planeOrientation: plane.orientation, resolvedTo: { shapeKind: 'wedge', rotation } })

      if (!stamp && !verbatim && pendingWedgeKeys) {
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
  } else if (kind === 'convex' || kind === 'concave') {
    // Explicit corner kinds: the autotile family painted directly, no neighbor sampling — always
    // resolved and frozen at paint time. Fresh paints start at the brush rotation; re-clicking
    // cycles the corner 90° (the wedge-style manual rotation). Revisits within the same stroke
    // are left untouched so a drag's interpolation can't spin what the stroke just wrote.
    const existing = state.model.chamfer.get(key)
    if (!stamp && strokeSlabKeys?.has(key)) {
      // Already touched this stroke — leave the chamfer entry exactly as the stroke left it.
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

/** Shared erase write (both layers, no selection concept) — `eraseCell` clips first, 3D skips it. */
function applyEraseCell(state: AppState, coord: Coord) {
  const key = encodeKey(...coord)
  state.model.color.delete(key)
  state.model.chamfer.delete(key)
  state.meta.modifiedAt = new Date().toISOString()
  state.dirty = true
}

/**
 * Recolor write: swaps the palette slot on an existing voxel, nothing else. Returns false (and
 * writes nothing, so the enclosing stroke stays a no-op) on empty cells and same-slot repaints.
 */
function applyMaterialCell(state: AppState, coord: Coord, slot: PaletteSlotRef): boolean {
  const key = encodeKey(...coord)
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
    // 3D-only mode never corrects: every paint is verbatim, frozen at click time.
    if (get().layoutMode === '3d-only') return
    // Outside an open stroke there is nothing stroke-local to correct (both tracking sets are
    // only non-null between beginStroke/commitStroke).
    if (!freshChamferKeys && !pendingWedgeKeys) return
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
      if (changed) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
  },

  paintCell: (u: number, v: number) => {
    get().bakeFloatIfAny()
    const { plane, activeVoxelKind, activePaletteSlot, selection, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    // An active selection clips editing to its mask (bakeFloatIfAny above already resolved any float).
    if (selection && !isCellSelected(selection, u, v)) {
      get().flashSelectionBlocked()
      return false
    }

    set((state) => {
      applyPaintCell(state, coord, u, v, plane, activeVoxelKind, activePaletteSlot)
    })
    return true
  },

  paintCellAtCoord: (coord: Coord, faceAxis: Axis, faceOrientation: Orientation) => {
    get().bakeFloatIfAny()
    const { activeVoxelKind, activePaletteSlot, meta } = get()
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    // The caller-supplied axis/orientation (3D taps pass the active construction plane, so
    // orientation always matches the brush preview — never the raycast face) on the target
    // cell's slice.
    // (Deliberately no selection clip — the 2D selection mask lives in the active plane's frame
    // and can't meaningfully clip a different face's slice.)
    const facePlane: ConstructionPlane = { axis: faceAxis, orientation: faceOrientation, offset: coord[axisIndex(faceAxis)] }
    const { u, v } = pixelFromGridCoord(facePlane, coord)
    set((state) => {
      applyPaintCell(state, coord, u, v, facePlane, activeVoxelKind, activePaletteSlot)
    })
    return true
  },

  paintLineAtCoord: (coord: Coord, extend: boolean) => {
    get().bakeFloatIfAny()
    const { plane, activeVoxelKind, activePaletteSlot, meta, planeLocked3D, paintLineAnchor } = get()
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
      set((state) => {
        for (const [lu, lv] of dominantAxisLine(a.u, a.v, b.u, b.v)) {
          const c = gridCoordFromPixel(plane, lu, lv)
          if (!withinWorkingBounds(c, meta.gridExtent)) continue
          // Unlocked taps never overwrite (matching single-tap semantics); locked taps replace.
          if (!planeLocked3D && state.model.color.has(encodeKey(...c))) continue
          applyPaintCell(state, c, lu, lv, plane, activeVoxelKind, activePaletteSlot)
        }
      })
    } else {
      ok = get().paintCellAtCoord(coord, plane.axis, plane.orientation)
    }
    get().commitStroke()
    return ok
  },

  eraseCell: (coord: Coord) => {
    get().bakeFloatIfAny()
    const { plane, selection } = get()
    if (selection) {
      const { u, v } = pixelFromGridCoord(plane, coord)
      if (!isCellSelected(selection, u, v)) {
        get().flashSelectionBlocked()
        return
      }
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

  fillSelection: () => {
    get().bakeFloatIfAny()
    const { plane, activeVoxelKind, activePaletteSlot, selectedCells, selection, meta } = get()
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
    set((state) => {
      for (const coord of coords) applyFillCell(state, coord, plane, activeVoxelKind, activePaletteSlot)
    })
    get().commitStroke()
  },

  paintMaterialCell: (u: number, v: number) => {
    get().bakeFloatIfAny()
    const { plane, activePaletteSlot, selection, meta } = get()
    const coord = gridCoordFromPixel(plane, u, v)
    if (!withinWorkingBounds(coord, meta.gridExtent)) return false
    if (selection && !isCellSelected(selection, u, v)) {
      get().flashSelectionBlocked()
      return false
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
