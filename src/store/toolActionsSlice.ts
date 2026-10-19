import type { StateCreator } from 'zustand'
import { encodeKey, expandBounds } from '@/engine/grid/GridStore'
import type { CellKey } from '@/engine/grid/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { rebaseChamferCell } from '@/engine/chamfer/faceBasis'
import { fillLeaksToEdges, floodFillOccupied3D, floodFillRegion, floodFillRegion3D } from '@/engine/tools/floodFill'
import { applyClipboardAt, clearRegion, copyRegionToClipboard, transformClipboardToPlane } from '@/engine/tools/clipboard'
import { copyCellsToClipboard, rotateCellsInPlane, selectionMatchesClipboard, snapshotCells } from '@/engine/tools/cellSetOps'
import { placedFloatCoords } from '@/engine/instancing/ghostBatches'
import { mirrorClipboard, rotateClipboard90 } from '@/engine/tools/transform'
import { forEachSelectedCell, isCellSelected, mirrorRegion, rotateRegion90 } from '@/engine/tools/selectionMask'
import type { AppState, SelectionTransformKind, ToolActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ToolActionsSlice>

// Invariant: every model-mutating action in this store must call `get().bakeFloatIfAny()` as its
// first line (before its own beginStroke()), so a pending float never gets silently dropped or
// desynced from the model. `undo`/`redo` (historySlice.ts) and `paintCell`/
// `eraseCell` (paintActions.ts) follow the same rule.
export const createToolActionsSlice: Slice = (set, get) => ({
  floodFill: (u, v) => {
    get().bakeFloatIfAny()
    const { model, plane, activePaletteSlot, selection, meta } = get()
    // A click inside the active selection treats the selection mask itself as the bound:
    // traversal never leaves the mask, so no painted enclosure is needed and the edge-leak
    // guard (which would reject the fill on an empty plane) is skipped.
    const inSelection = !!selection && isCellSelected(selection, u, v)
    let cells = inSelection
      ? floodFillRegion(model, plane, u, v, meta.gridExtent, (cu, cv) => isCellSelected(selection, cu, cv))
      : floodFillRegion(model, plane, u, v, meta.gridExtent)
    if (!inSelection) {
      // A region that reaches all 4 edges of the plane almost certainly leaked through a gap rather
      // than being deliberately enclosed — reject it outright rather than repaint the whole plane.
      if (fillLeaksToEdges(cells, meta.gridExtent)) {
        if (selection) get().flashSelectionBlocked()
        return
      }
      // An active selection clips the fill to its mask: a click outside it that filters down to
      // nothing was blocked by the selection, not by an empty region — say so in the footer.
      if (selection) {
        cells = cells.filter(([cu, cv]) => isCellSelected(selection, cu, cv))
        if (cells.length === 0) {
          get().flashSelectionBlocked()
          return
        }
      }
    }
    if (cells.length === 0) return
    get().beginStroke()
    set((state) => {
      for (const [cu, cv] of cells) {
        const coord = gridCoordFromPixel(state.plane, cu, cv)
        state.model.color.set(encodeKey(...coord), { paletteSlot: activePaletteSlot })
        state.model.bounds = expandBounds(state.model.bounds, coord)
      }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  floodFill3D: (u, v) => {
    get().bakeFloatIfAny()
    const { model, plane, activePaletteSlot, meta } = get()
    const startCoord = gridCoordFromPixel(plane, u, v)
    if (!model.color.has(encodeKey(...startCoord))) return // only fills from an existing voxel
    const keys = floodFillRegion3D(model, startCoord, meta.gridExtent)
    if (keys.length === 0) return
    get().beginStroke()
    set((state) => {
      for (const key of keys) {
        state.model.color.set(key, { paletteSlot: activePaletteSlot })
      }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  floodFillCellsAt: (coord, alt) => {
    get().bakeFloatIfAny()
    const { model, activePaletteSlot, selectedCells, meta } = get()
    // Voxel tap: material-only volume fill — recolors, never touches geometry (chamfer) and
    // never moves the plane (the 3D tap path returns before plane-setting). Plain floods the
    // color-connected volume; Alt takes the whole touching component regardless of color,
    // mirroring the wand's two stages.
    if (model.color.has(encodeKey(...coord))) {
      let keys = alt
        ? floodFillOccupied3D(model, coord, meta.gridExtent)
        : floodFillRegion3D(model, coord, meta.gridExtent)
      if (selectedCells.size > 0) {
        keys = keys.filter((key) => selectedCells.has(key))
        if (keys.length === 0) {
          get().flashSelectionBlocked()
          return
        }
      }
      if (keys.length === 0) return
      get().beginStroke()
      set((state) => {
        for (const key of keys) {
          state.model.color.set(key, { paletteSlot: activePaletteSlot })
        }
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      })
      get().commitStroke()
      return
    }
    // Empty-space tap: Alt does nothing; otherwise the planar slice fill at the plane UV
    // (leak-guarded), same contract as the 2D `floodFill`.
    if (alt) return
    const { plane } = get()
    // The 3D selection is planar (window select never leaves the slice), so the set reads as
    // a UV mask on the active plane for the slice fill below.
    const inSet = (cu: number, cv: number) => selectedCells.has(encodeKey(...gridCoordFromPixel(plane, cu, cv)))
    const { u, v } = pixelFromGridCoord(plane, coord)
    // Same contract as the 2D `floodFill`, masked by the 3D set: a tap inside the window
    // treats the window itself as the bound (no leak guard needed); otherwise the leak
    // guard applies and the result clips to the window.
    const inSelection = selectedCells.size > 0 && inSet(u, v)
    let cells = inSelection
      ? floodFillRegion(model, plane, u, v, meta.gridExtent, inSet)
      : floodFillRegion(model, plane, u, v, meta.gridExtent)
    if (!inSelection) {
      if (fillLeaksToEdges(cells, meta.gridExtent)) {
        if (selectedCells.size > 0) get().flashSelectionBlocked()
        return
      }
      if (selectedCells.size > 0) {
        cells = cells.filter(([cu, cv]) => inSet(cu, cv))
        if (cells.length === 0) {
          get().flashSelectionBlocked()
          return
        }
      }
    }
    if (cells.length === 0) return
    get().beginStroke()
    set((state) => {
      for (const [cu, cv] of cells) {
        const c = gridCoordFromPixel(state.plane, cu, cv)
        state.model.color.set(encodeKey(...c), { paletteSlot: activePaletteSlot })
        state.model.bounds = expandBounds(state.model.bounds, c)
      }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  copySelection: () => {
    // Not model-mutating, but bake first so we copy what's currently visible (the moved/
    // transformed position) rather than stale pre-lift content.
    get().bakeFloatIfAny()
    const { model, plane, selection } = get()
    if (!selection) return
    const clipboard = copyRegionToClipboard(model, plane, selection)
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
    const { selection } = get()
    if (!selection) return
    get().beginStroke()
    set((state) => {
      clearRegion(state.model, state.plane, selection)
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
        const cell = state.model.chamfer.get(encodeKey(...coord))
        // Plain cubes sample texture by face normal — never mis-faced, silently ignored.
        if (!cell) return
        if (rebaseChamferCell(cell, state.plane.axis, state.plane.orientation)) faced++
        else skipped++
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
    const transformedClipboard = transformClipboardToPlane(clipboard, plane)
    get().beginStroke()
    set((state) => {
      state.floatContent = transformedClipboard
      state.floatOrigin = { originU: u, originV: v }
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
    const { model, plane, selection, floatContent, meta } = get()
    if (!selection || floatContent) return
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

  moveFloatTo: (originU, originV) => {
    if (!get().floatContent) return
    set((state) => {
      state.floatOrigin = { originU, originV }
      state.selection = { ...state.selection!, originU, originV }
    })
  },

  moveFloatCellsTo: (originU, originV) => {
    // 3D exact-set moves: reposition the pending float without touching the 2D selection
    // (the 3D set tracks position separately — see the drop handler in Viewport3D.tsx).
    if (!get().floatContent) return
    set((state) => {
      state.floatOrigin = { originU, originV }
    })
  },

  transformFloat: (kind) => {
    get().liftSelectionToFloat() // no-op if already floating
    const { floatContent, selection } = get()
    if (!floatContent || !selection) return
    const spin = kind === 'rotate' ? 'cw' : kind === 'rotate-ccw' ? 'ccw' : null
    const flip = kind === 'mirror-h' ? 'horizontal' : 'vertical'
    const transformedContent = spin ? rotateClipboard90(floatContent, spin) : mirrorClipboard(floatContent, flip)
    const transformedRegion = spin ? rotateRegion90(selection, spin) : mirrorRegion(selection, flip)
    set((state) => {
      state.floatContent = transformedContent
      state.floatOrigin = { originU: transformedRegion.originU, originV: transformedRegion.originV }
      state.selection = transformedRegion
    })
  },

  bakeFloatIfAny: () => {
    const { floatContent, floatOrigin, plane, meta } = get()
    if (!floatContent || !floatOrigin) return
    set((state) => {
      applyClipboardAt(state.model, plane, floatContent, floatOrigin.originU, floatOrigin.originV, meta.gridExtent)
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
    const live = [...cells].filter((key) => model.color.has(key))
    if (live.length === 0) return // every key stale — nothing to lift, no stroke
    const content = copyCellsToClipboard(model, live, plane)
    get().beginStroke()
    set((state) => {
      for (const key of live) {
        state.model.color.delete(key)
        state.model.chamfer.delete(key)
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
    // Same rebase as the 2D paste path so cross-plane pastes land on screen correctly.
    const transformed = transformClipboardToPlane(clipboard, plane)
    const originU = transformed.originU ?? 0
    const originV = transformed.originV ?? 0

    // Targeted paste: a selection holding no live voxels whose frame matches the clipboard's
    // dimensions is a paste destination, not something to preserve — stamp into it directly
    // (one undo step; an empty frame has nothing to stomp) and keep the selection.
    const hasLive = [...selectedCells].some((key) => model.color.has(key))
    const match = !hasLive ? selectionMatchesClipboard(selectedCells, transformed, plane) : null
    if (match) {
      const base =
        transformed.copyPlaneAxis === plane.axis && transformed.copyPlaneOrientation === plane.orientation
          ? (transformed.copyPlaneOffset ?? plane.offset)
          : plane.offset
      // Re-anchor the depth profile onto the selection frame's min depth: applyClipboardAt
      // lands `base + dw`, so shift every cell so its min-dw sits on the frame.
      const shifted = {
        ...transformed,
        cells: transformed.cells.map((cell) => ({ ...cell, dw: cell.dw - match.minDw + match.minW - base })),
      }
      get().beginStroke()
      set((state) => {
        applyClipboardAt(state.model, state.plane, shifted, match.originU, match.originV, meta.gridExtent)
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
    const footprint = placedFloatCoords(transformed, { originU, originV }, plane, meta.gridExtent)
    get().beginStroke()
    set((state) => {
      state.floatContent = transformed
      state.floatOrigin = { originU, originV }
      state.selectedCells = new Set(footprint.map((c) => encodeKey(...c)))
    })
    // Deliberately no commitStroke() — this stroke stays open until bakeFloatIfAny().
  },

  deleteCells3D: () => {
    get().bakeFloatIfAny()
    const { model, selectedCells } = get()
    const live = [...selectedCells].filter((key) => model.color.has(key))
    if (live.length === 0) return
    get().beginStroke()
    set((state) => {
      for (const key of live) {
        state.model.color.delete(key)
        state.model.chamfer.delete(key)
      }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  rotateCells3D: (kind: SelectionTransformKind) => {
    get().bakeFloatIfAny()
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
      }
      for (const e of moved) {
        const key = encodeKey(...e.coord)
        state.model.color.set(key, { paletteSlot: e.paletteSlot })
        if (e.chamfer) state.model.chamfer.set(key, e.chamfer)
        else state.model.chamfer.delete(key)
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
        if (!cell) continue
        if (rebaseChamferCell(cell, state.plane.axis, state.plane.orientation)) faced++
        else skipped++
      }
      if (faced > 0) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
    get().commitStroke()
    return { faced, skipped }
  },
})
