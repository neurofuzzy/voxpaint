import type { StateCreator } from 'zustand'
import { showToast } from '@/components/ui/toastBus'
import { encodeKey, expandBounds } from '@/engine/grid/GridStore'
import type { CellKey } from '@/engine/grid/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { rebaseChamferCell } from '@/engine/chamfer/faceBasis'
import { fillLeaksToEdges } from '@/engine/tools/floodFill'
import { fillUnits, floodPlanarUnits, floodVolumeUnits, gridRes, planeUnitAt, unitAt, unitBox, unitColor, unitPlaneCells, unitQuadrant, type Unit } from '@/engine/tools/gridFlood'
import { isSelectedAt } from '@/engine/tools/fineSelection'
import { clipboardDepthBase, clipboardHalfShift, clearRegion, copyRegionToClipboard, transformClipboardToPlane } from '@/engine/tools/clipboard'
import { copyCellsToClipboard, isCoplanarWithPlane, rotateCellsInPlane, selectionMatchesClipboard, selectionRegionFromCoplanarCells, snapshotCells } from '@/engine/tools/cellSetOps'
import { placedFloatCoords } from '@/engine/instancing/ghostBatches'
import { mirrorClipboard, rotateClipboard90 } from '@/engine/tools/transform'
import { forEachSelectedCell, mirrorRegion, rotateRegion90 } from '@/engine/tools/selectionMask'
import { clearFineRegion } from '@/engine/grid/fineOps'
import { liveFineSelection3D } from './selection3DSlice'
import { applyFloatAt, fineFloatAtomic, floatFootprintRegion, placeFloat, settleFloatOrigin } from '@/engine/tools/fineFloat'
import { childBox, planeFrame, worldBitsFromQuad } from '@/engine/grid/cellBox'
import type { AppState, FloatOrigin, SelectionRegion, SelectionTransformKind, ToolActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ToolActionsSlice>

/**
 * A 2D selection as the grid addresses it: on a half-voxel stop (the grid cuts the plane axis) a
 * whole-cell selection — select-all, a whole paste footprint, one made before the grid changed —
 * covers the plane's slab only, exactly like a selection drawn there. Full-depth (Alt) lifts keep
 * whole voxels. Applied where a selection is consumed (copy, delete, lift).
 */
function gridSelection(selection: SelectionRegion, plane: AppState['plane']): SelectionRegion {
  if (selection.fine || plane.half === null) return selection
  return { ...selection, fine: { su: 1, sv: 1, slab: plane.half, mask: new Uint8Array(selection.mask) } }
}

/** The 2D selection a float at `o` shows: its exact fine footprint when the content or the
 * position is sub-voxel, else null (callers keep the whole-cell region). */
function floatSelection(plane: AppState['plane'], clip: NonNullable<AppState['floatContent']>, o: FloatOrigin) {
  if (!clip.fine && !o.subU && !o.subV) return null
  return floatFootprintRegion(plane, clip, o.originU, o.originV, o.subU ?? 0, o.subV ?? 0)
}

/** The whole-cell selection of a float's cells at `o` (every clipboard cell's du/dv). */
function cellsRegion(clip: NonNullable<AppState['floatContent']>, o: FloatOrigin) {
  const mask = new Uint8Array(clip.width * clip.height)
  for (const c of clip.cells) mask[c.dv * clip.width + c.du] = 1
  return { originU: o.originU, originV: o.originV, width: clip.width, height: clip.height, mask }
}

/**
 * The half-voxel depth shift a paste takes so it sits at the same depth relative to the plane's
 * stop as the copy did (`clipboardHalfShift`). Content holding whole chamfer cells has no
 * half-voxel position (`fineFloatAtomic`), so it stays on the whole-voxel layer — said once.
 */
function pasteHalfShift(plane: AppState['plane'], clipboard: NonNullable<AppState['clipboard']>): -1 | 0 | 1 {
  const shift = clipboardHalfShift(plane, clipboard)
  if (shift === 0 || !fineFloatAtomic(clipboard)) return shift
  showToast('Whole bevels sit on whole voxels — pasted on the voxel layer, not the half step')
  return 0
}

// Invariant: every model-mutating action in this store must call `get().bakeFloatIfAny()` as its
// first line (before its own beginStroke()), so a pending float never gets silently dropped or
// desynced from the model. `undo`/`redo` (historySlice.ts) and `paintCell`/
// `eraseCell` (paintActions.ts) follow the same rule.
export const createToolActionsSlice: Slice = (set, get) => {
  /**
   * Planar flood write at grid resolution (`floodPlanarUnits`): the flooded units are either all
   * empty (painted) or all one colour (recolored) — the grid's cells on the plane's slab. A start
   * inside `within` (the selection) bounds the fill to it, skipping the edge-leak guard; otherwise
   * a region reaching all 4 edges of the plane's span is rejected as a leak, and the result clips
   * to `within` (a fill clipped to nothing flashes the selection-blocked alert).
   */
  const planarFill = (start: Unit, within: ((unit: Unit) => boolean) | null) => {
    const { model, plane, activePaletteSlot, meta, gridSplit } = get()
    const res = gridRes(gridSplit)
    const inSelection = !!within && within(start)
    let units = floodPlanarUnits(model, plane, res, start, meta.gridExtent, inSelection ? within! : undefined)
    if (!inSelection) {
      if (fillLeaksToEdges(unitPlaneCells(plane, res, units), meta.gridExtent)) {
        if (within) get().flashSelectionBlocked()
        return
      }
      if (within) {
        units = units.filter(within)
        if (units.length === 0) {
          get().flashSelectionBlocked()
          return
        }
      }
    }
    if (units.length === 0) return
    get().beginStroke()
    set((state) => {
      fillUnits(state.model, res, units, activePaletteSlot)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  }

  return {
  floodFill: (u, v, qu, qv) => {
    get().bakeFloatIfAny()
    const { plane, selection, gridSplit } = get()
    const res = gridRes(gridSplit)
    const bits = qu === undefined || qv === undefined ? null : worldBitsFromQuad(plane, qu, qv)
    const start = planeUnitAt(res, plane, gridCoordFromPixel(plane, u, v), bits)
    // The 2D selection as a unit mask (fine selections per sub-cell, on their own slab).
    const within = selection
      ? (unit: Unit) => {
        const { u: pu, v: pv } = pixelFromGridCoord(plane, unitBox(res, unit).cell)
        const q = unitQuadrant(plane, res, unit)
        return isSelectedAt(selection, plane, pu, pv, q.qu, q.qv)
      }
      : null
    planarFill(start, within)
  },

  floodFill3D: (u, v, qu, qv) => {
    get().bakeFloatIfAny()
    const { model, plane, activePaletteSlot, meta, gridSplit } = get()
    const res = gridRes(gridSplit)
    const bits = qu === undefined || qv === undefined ? null : worldBitsFromQuad(plane, qu, qv)
    const start = planeUnitAt(res, plane, gridCoordFromPixel(plane, u, v), bits)
    // Only fills from existing content; recolors at grid resolution, never reshapes.
    const units = floodVolumeUnits(model, res, start, 'color', meta.gridExtent)
    if (units.length === 0) return
    get().beginStroke()
    set((state) => {
      fillUnits(state.model, res, units, activePaletteSlot)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  floodFillCellsAt: (coord, alt, bits = null) => {
    get().bakeFloatIfAny()
    const { model, activePaletteSlot, selectedCells, meta, gridSplit, plane } = get()
    const res = gridRes(gridSplit)
    // Voxel tap: material-only volume fill at grid resolution — recolors, never touches geometry
    // (chamfer) and never moves the plane (the 3D tap path returns before plane-setting). Plain
    // floods the color-connected volume; Alt takes the whole touching component regardless of
    // color, mirroring the wand's two stages. The tapped grid cell is the one the hit is in.
    const tapped = unitAt(res, coord, bits)
    if (unitColor(model, res, tapped) !== null) {
      let units = floodVolumeUnits(model, res, tapped, alt ? 'occupied' : 'color', meta.gridExtent)
      if (selectedCells.size > 0) {
        units = units.filter((unit) => selectedCells.has(encodeKey(...unitBox(res, unit).cell)))
        if (units.length === 0) {
          get().flashSelectionBlocked()
          return
        }
      }
      if (units.length === 0) return
      get().beginStroke()
      set((state) => {
        fillUnits(state.model, res, units, activePaletteSlot)
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      })
      get().commitStroke()
      return
    }
    // Empty-space tap: Alt does nothing; otherwise the planar slice fill at the plane cell (at the
    // plane's slab), same contract as the 2D `floodFill`. The 3D selection is planar (window
    // select never leaves the slice), so the set reads as a cell mask on the active plane.
    if (alt) return
    const within = selectedCells.size > 0 ? (unit: Unit) => selectedCells.has(encodeKey(...unitBox(res, unit).cell)) : null
    planarFill(planeUnitAt(res, plane, coord, bits), within)
  },

  copySelection: () => {
    // Not model-mutating, but bake first so we copy what's currently visible (the moved/
    // transformed position) rather than stale pre-lift content.
    get().bakeFloatIfAny()
    const { model, plane, selection } = get()
    if (!selection) return
    const clipboard = copyRegionToClipboard(model, plane, gridSelection(selection, plane))
    set((state) => {
      state.clipboard = clipboard
    })
  },

  cutSelection: () => {
    if (!get().selection) return
    get().copySelection()
    get().deleteSelection()
  },

  deleteSelection: () => {
    get().bakeFloatIfAny()
    const { selection: raw, plane } = get()
    if (!raw) return
    const selection = gridSelection(raw, plane)
    get().beginStroke()
    set((state) => {
      if (selection.fine) clearFineRegion(state.model, state.plane, selection)
      else clearRegion(state.model, state.plane, selection)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  faceSelection: () => {
    get().bakeFloatIfAny()
    const { selection } = get()
    if (!selection) return { faced: 0, skipped: 0 }
    let faced = 0
    let skipped = 0
    get().beginStroke()
    set((state) => {
      // Only cells on the active slice: the selection mask lives in the active plane's frame,
      // so anything off-slice is outside what's actually selected.
      forEachSelectedCell(selection, (u, v) => {
        const coord = gridCoordFromPixel(state.plane, u, v)
        const key = encodeKey(...coord)
        const cell = state.model.chamfer.get(key)
        // Plain cubes sample texture by face normal — never mis-faced, silently ignored.
        if (cell) {
          if (rebaseChamferCell(cell, state.plane.axis, state.plane.orientation)) faced++
          else skipped++
          return
        }
        // Detail bevels: each beveled grid cell the selection covers (its sub-cell, on the slab).
        const sub = state.model.subdiv.get(key)
        if (!sub) return
        const { uA, vA, wA, uPos, vPos } = planeFrame(state.plane.axis)
        sub.children.forEach((child, i) => {
          if (!child?.chamfer) return
          const box = childBox(sub.split, i)
          if (box[wA] !== null && state.plane.half !== null && box[wA] !== state.plane.half) return
          const qu = box[uA] === null ? undefined : uPos ? box[uA]! : 1 - box[uA]!
          const qv = box[vA] === null ? undefined : vPos ? box[vA]! : 1 - box[vA]!
          if (!isSelectedAt(selection, state.plane, u, v, qu, qv)) return
          if (rebaseChamferCell(child.chamfer, state.plane.axis, state.plane.orientation)) faced++
          else skipped++
        })
      })
      if (faced > 0) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
    get().commitStroke()
    return { faced, skipped }
  },

  pasteClipboardInPlace: () => {
    const { clipboard, plane } = get()
    if (!clipboard) return
    // Paste-in-place is "same spot on screen", not "same (u,v)" — when the plane has changed since
    // the copy, the origin has to be rebased through the same transform the content gets.
    const { originU, originV } = transformClipboardToPlane(clipboard, plane)
    get().pasteClipboardAt(originU ?? 0, originV ?? 0)
  },

  pasteClipboardAt: (u, v) => {
    get().bakeFloatIfAny()
    const { clipboard, plane } = get()
    if (!clipboard) return
    if (clipboard.fine && (clipboard.copyPlaneAxis !== plane.axis || clipboard.copyPlaneOrientation !== plane.orientation)) {
      // A sub-voxel copy is expressed in its source plane's frame; re-framing it is not built yet.
      showToast('Sub-voxel content can only be pasted onto the plane it was copied from')
      return
    }
    // Depth follows the plane's stop exactly, half voxels included (computed off the clipboard
    // as copied — the cross-plane rebase below resets its source stop).
    const subW = pasteHalfShift(plane, clipboard)
    const transformedClipboard = transformClipboardToPlane(clipboard, plane)
    get().beginStroke()
    set((state) => {
      state.floatContent = transformedClipboard
      if (transformedClipboard.fine) {
        state.floatOrigin = { originU: u, originV: v, subU: 0, subV: 0, ...(subW ? { subW } : {}) }
        state.selection = floatFootprintRegion(plane, transformedClipboard, u, v, 0, 0)
        return
      }
      state.floatOrigin = { originU: u, originV: v, ...(subW ? { subW } : {}) }
      state.selection = {
        originU: u,
        originV: v,
        width: transformedClipboard.width,
        height: transformedClipboard.height,
        mask: new Uint8Array(transformedClipboard.width * transformedClipboard.height).fill(1),
      }
    })
  },

  liftSelectionToFloat: (deep = false) => {
    const { model, plane, selection: raw, floatContent, meta } = get()
    if (!raw || floatContent) return
    const selection = deep ? raw : gridSelection(raw, plane)
    if (selection.fine) {
      if (deep) {
        showToast('Full-depth lifts are whole-voxel: turn the grid to whole, or lift without Alt')
        return
      }
      // Sub-voxel lift: copy exactly the selected parts, clear exactly those fine cells.
      const fineContent = copyRegionToClipboard(model, plane, selection)
      get().beginStroke()
      set((state) => {
        clearFineRegion(state.model, state.plane, selection)
        state.floatContent = fineContent
        state.floatOrigin = { originU: selection.originU, originV: selection.originV, subU: 0, subV: 0 }
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      })
      return
    }
    const content = copyRegionToClipboard(model, plane, selection, deep, meta.gridExtent)
    get().beginStroke()
    set((state) => {
      clearRegion(state.model, state.plane, selection, deep, meta.gridExtent)
      state.floatContent = content
      state.floatOrigin = { originU: selection.originU, originV: selection.originV }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    // Deliberately no commitStroke() — this stroke stays open until bakeFloatIfAny().
  },

  moveFloatTo: (originU, originV, subU = 0, subV = 0) => {
    const { floatContent, floatOrigin, plane } = get()
    if (!floatContent) return
    const at = settleFloatOrigin(floatContent, { originU, originV, subU, subV, subW: floatOrigin?.subW })
    set((state) => {
      state.floatOrigin = at
      // The selection tracks the float's exact footprint (fine when it sits off the voxel grid).
      // Back on the voxel grid: whole cells (re-derived when the previous footprint was fine).
      state.selection = floatSelection(plane, floatContent, at)
        ?? (state.selection?.fine ? cellsRegion(floatContent, at) : { ...state.selection!, originU: at.originU, originV: at.originV })
    })
  },

  moveFloatCellsTo: (originU, originV, subU = 0, subV = 0) => {
    // 3D exact-set moves: reposition the pending float without touching the 2D selection
    // (the 3D set tracks position separately — see the drop handler in Viewport3D.tsx).
    const fc = get().floatContent
    if (!fc) return
    const at = settleFloatOrigin(fc, { originU, originV, subU, subV, subW: get().floatOrigin?.subW })
    set((state) => {
      state.floatOrigin = at
    })
  },

  transformFloat: (kind) => {
    get().liftSelectionToFloat() // no-op if already floating
    const { floatContent, selection, floatOrigin, plane } = get()
    if (!floatContent || !selection) return
    const spin = kind === 'rotate' ? 'cw' : kind === 'rotate-ccw' ? 'ccw' : null
    const flip = kind === 'mirror-h' ? 'horizontal' : 'vertical'
    const transformedContent = spin ? rotateClipboard90(floatContent, spin) : mirrorClipboard(floatContent, flip)
    const o = floatOrigin ?? { originU: selection.originU, originV: selection.originV }
    if (transformedContent.fine || o.subU || o.subV) {
      // Off-grid float: rotate/mirror in place about its frame; the selection is its new footprint.
      const at = settleFloatOrigin(transformedContent, o)
      set((state) => {
        state.floatContent = transformedContent
        state.floatOrigin = at
        state.selection = floatSelection(plane, transformedContent, at)
      })
      return
    }
    const transformedRegion = spin ? rotateRegion90(selection, spin) : mirrorRegion(selection, flip)
    set((state) => {
      state.floatContent = transformedContent
      state.floatOrigin = settleFloatOrigin(transformedContent, { originU: transformedRegion.originU, originV: transformedRegion.originV, subW: o.subW })
      state.selection = transformedRegion
    })
  },

  bakeFloatIfAny: () => {
    const { floatContent, floatOrigin, plane, meta } = get()
    if (!floatContent || !floatOrigin) return
    set((state) => {
      placeFloat(state.model, plane, floatContent, floatOrigin, meta.gridExtent)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
    set((state) => {
      state.floatContent = null
      state.floatOrigin = null
    })
  },

  liftCellsToFloat: (cells) => {
    get().bakeFloatIfAny()
    const { model, plane, floatContent } = get()
    if (cells.size === 0 || floatContent) return
    const fine3 = liveFineSelection3D(get())
    if (fine3) {
      if (fine3.plane.axis !== plane.axis || fine3.plane.orientation !== plane.orientation) {
        showToast('Sub-voxel selections move on the plane they were drawn on')
        return
      }
      // Sub-voxel lift: take exactly the selected parts; the float lands via the fine bake.
      const fineContent = copyRegionToClipboard(model, plane, fine3.region)
      get().beginStroke()
      set((state) => {
        clearFineRegion(state.model, plane, fine3.region)
        state.floatContent = fineContent
        state.floatOrigin = { originU: fine3.region.originU, originV: fine3.region.originV, subU: 0, subV: 0 }
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      })
      return
    }
    const live = [...cells].filter((key) => model.color.has(key) || model.subdiv.has(key))
    if (live.length === 0) return // every key stale — nothing to lift, no stroke
    const content = copyCellsToClipboard(model, live, plane)
    get().beginStroke()
    set((state) => {
      for (const key of live) {
        state.model.color.delete(key)
        state.model.chamfer.delete(key)
        state.model.subdiv.delete(key)
      }
      state.floatContent = content
      state.floatOrigin = { originU: content.originU ?? 0, originV: content.originV ?? 0 }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    // Deliberately no commitStroke() — this stroke stays open until bakeFloatIfAny().
  },

  copyCells3D: () => {
    get().bakeFloatIfAny()
    const { model, plane, selectedCells } = get()
    if (selectedCells.size === 0) return
    const fine = liveFineSelection3D(get())
    if (fine) {
      // Sub-voxel window: copy just its parts, off the plane it was drawn on.
      const clipboard = copyRegionToClipboard(model, fine.plane, fine.region)
      if (clipboard.cells.length === 0) return
      set((state) => { state.clipboard = clipboard })
      return
    }
    // Parity rule: a selection lying entirely on the active construction plane copies
    // through the 2D slice-anchored path, so moving the plane then pasting lands the
    // content on the new plane (`clipboardDepthBase` follows the destination slice).
    // Multi-depth selections fall back to the bbox-anchored volumetric copy below.
    if (isCoplanarWithPlane(selectedCells, plane)) {
      const live = [...selectedCells].filter((key) => model.color.has(key) || model.subdiv.has(key))
      if (live.length === 0) return
      const region = selectionRegionFromCoplanarCells(live, plane)
      if (!region) return
      const clipboard = copyRegionToClipboard(model, plane, region)
      if (clipboard.cells.length === 0) return
      set((state) => {
        state.clipboard = clipboard
      })
      return
    }
    const clipboard = copyCellsToClipboard(model, selectedCells, plane)
    if (clipboard.cells.length === 0) return
    set((state) => {
      state.clipboard = clipboard
    })
  },

  cutCells3D: () => {
    if (get().selectedCells.size === 0) return
    get().copyCells3D()
    get().deleteCells3D()
  },

  pasteCells3D: () => {
    get().bakeFloatIfAny()
    const { clipboard, plane, meta, model, selectedCells } = get()
    if (!clipboard || clipboard.cells.length === 0) return
    if (clipboard.fine) {
      // A sub-voxel copy pastes as a sub-voxel float in the same frame (drag it, then drop).
      get().pasteClipboardInPlace()
      return
    }
    // Same rebase as the 2D paste path so cross-plane pastes land on screen correctly; depth
    // follows the plane's stop exactly, half voxels included (off the clipboard as copied).
    const subW = pasteHalfShift(plane, clipboard)
    const transformed = transformClipboardToPlane(clipboard, plane)
    const originU = transformed.originU ?? 0
    const originV = transformed.originV ?? 0

    // Targeted paste: a selection holding no live voxels whose frame matches the clipboard's
    // dimensions is a paste destination, not something to preserve — stamp into it directly
    // (one undo step; an empty frame has nothing to stomp) and keep the selection.
    const hasLive = [...selectedCells].some((key) => model.color.has(key) || model.subdiv.has(key))
    const match = !hasLive ? selectionMatchesClipboard(selectedCells, transformed, plane) : null
    if (match) {
      // Same depth base `applyClipboardAt` will land on, so the min-dw shift below is exact.
      const base = clipboardDepthBase(plane, transformed)
      // Re-anchor the depth profile onto the selection frame's min depth: applyClipboardAt
      // lands `base + dw`, so shift every cell so its min-dw sits on the frame.
      const shifted = {
        ...transformed,
        cells: transformed.cells.map((cell) => ({ ...cell, dw: cell.dw - match.minDw + match.minW - base })),
      }
      get().beginStroke()
      set((state) => {
        const at = { originU: match.originU, originV: match.originV, ...(subW ? { subW } : {}) }
        placeFloat(state.model, state.plane, shifted, at, meta.gridExtent)
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      })
      get().commitStroke()
      return
    }

    // Floating paste: pull the content out as a pending float — nothing is written yet, so
    // copy+paste+drag duplicates instead of stomping the source — and select its footprint.
    // The 3D view ghosts the float and select/wand drags inside its footprint move it; the
    // drop (or any bake trigger) stamps it. Opens an undo stroke like every other lift/paste.
    const footprint = placedFloatCoords(transformed, { originU, originV, ...(subW ? { subW } : {}) }, plane, meta.gridExtent)
    get().beginStroke()
    set((state) => {
      state.floatContent = transformed
      state.floatOrigin = { originU, originV, ...(subW ? { subW } : {}) }
      state.selectedCells = new Set(footprint.map((c) => encodeKey(...c)))
    })
    // Deliberately no commitStroke() — this stroke stays open until bakeFloatIfAny().
  },

  deleteCells3D: () => {
    get().bakeFloatIfAny()
    const fine = liveFineSelection3D(get())
    if (fine) {
      get().beginStroke()
      set((state) => {
        clearFineRegion(state.model, fine.plane, fine.region)
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      })
      get().commitStroke()
      return
    }
    const { model, selectedCells } = get()
    const live = [...selectedCells].filter((key) => model.color.has(key) || model.subdiv.has(key))
    if (live.length === 0) return
    get().beginStroke()
    set((state) => {
      for (const key of live) {
        state.model.color.delete(key)
        state.model.chamfer.delete(key)
        state.model.subdiv.delete(key)
      }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  rotateCells3D: (kind: SelectionTransformKind) => {
    get().bakeFloatIfAny()
    const fine3 = liveFineSelection3D(get())
    if (fine3) {
      // Sub-voxel transform in place: lift the selected parts, turn them about their frame, drop.
      const { model, meta } = get()
      const content = copyRegionToClipboard(model, fine3.plane, fine3.region)
      const spin = kind === 'rotate' ? 'cw' : kind === 'rotate-ccw' ? 'ccw' : null
      const transformed = spin ? rotateClipboard90(content, spin) : mirrorClipboard(content, kind === 'mirror-h' ? 'horizontal' : 'vertical')
      const { originU, originV } = fine3.region
      const region = floatFootprintRegion(fine3.plane, transformed, originU, originV, 0, 0)
      get().beginStroke()
      set((state) => {
        clearFineRegion(state.model, fine3.plane, fine3.region)
        applyFloatAt(state.model, fine3.plane, transformed, { originU, originV }, meta.gridExtent)
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      })
      get().commitStroke()
      if (region) get().setSelectedFine({ region, plane: fine3.plane })
      return
    }
    const { model, plane, meta, selectedCells } = get()
    const entries = snapshotCells(model, selectedCells)
    if (entries.length === 0) return
    const moved = rotateCellsInPlane(entries, plane, kind, meta.gridExtent)
    get().beginStroke()
    const placed: CellKey[] = []
    set((state) => {
      for (const key of selectedCells) {
        state.model.color.delete(key)
        state.model.chamfer.delete(key)
        state.model.subdiv.delete(key)
      }
      for (const e of moved) {
        const key = encodeKey(...e.coord)
        if (e.subdiv) {
          state.model.subdiv.set(key, e.subdiv)
          state.model.color.delete(key)
          state.model.chamfer.delete(key)
        } else {
          state.model.color.set(key, { paletteSlot: e.paletteSlot })
          state.model.subdiv.delete(key)
          if (e.chamfer) state.model.chamfer.set(key, e.chamfer)
          else state.model.chamfer.delete(key)
        }
        state.model.bounds = expandBounds(state.model.bounds, e.coord)
        placed.push(key)
      }
      state.selectedCells = new Set(placed)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  faceCells3D: () => {
    get().bakeFloatIfAny()
    const { selectedCells } = get()
    if (selectedCells.size === 0) return { faced: 0, skipped: 0 }
    let faced = 0
    let skipped = 0
    get().beginStroke()
    set((state) => {
      // Same per-cell rule as faceSelection (see its docblock); the set spans depths, and each
      // cell is judged on its own basis — plain cubes need no facing and are skipped silently.
      for (const key of selectedCells) {
        const cell = state.model.chamfer.get(key)
        if (cell) {
          if (rebaseChamferCell(cell, state.plane.axis, state.plane.orientation)) faced++
          else skipped++
          continue
        }
        // Detail bevels inside a selected voxel are faced too.
        for (const child of state.model.subdiv.get(key)?.children ?? []) {
          if (!child?.chamfer) continue
          if (rebaseChamferCell(child.chamfer, state.plane.axis, state.plane.orientation)) faced++
          else skipped++
        }
      }
      if (faced > 0) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
    get().commitStroke()
    return { faced, skipped }
  },
}
}
