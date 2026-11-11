import type { StateCreator } from 'zustand'
import { showToast } from '@/components/ui/toastBus'
import { decodeKey, encodeKey, expandBounds } from '@/engine/grid/GridStore'
import type { CellKey, Coord } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { rebaseChamferCell } from '@/engine/chamfer/faceBasis'
import { fillLeaksToEdges, floodFillOccupied3D, floodFillRegion, floodFillRegion3D } from '@/engine/tools/floodFill'
import { applyClipboardAt, clipboardDepthBase, clearRegion, copyRegionToClipboard, transformClipboardToPlane } from '@/engine/tools/clipboard'
import { copyCellsToClipboard, isCoplanarWithPlane, rotateCellsInPlane, selectionMatchesClipboard, selectionRegionFromCoplanarCells, snapshotCells } from '@/engine/tools/cellSetOps'
import { placedFloatCoords } from '@/engine/instancing/ghostBatches'
import { mirrorClipboard, rotateClipboard90 } from '@/engine/tools/transform'
import { forEachSelectedCell, isCellSelected, mirrorRegion, rotateRegion90 } from '@/engine/tools/selectionMask'
import { clearFineRegion } from '@/engine/grid/fineOps'
import { liveFineSelection3D } from './selection3DSlice'
import { applyFineClipboardAt, floatFootprintRegion } from '@/engine/tools/fineFloat'
import { childInSlab, ensureSplitForPaint, frontSlabBit, paintSubCell } from '@/engine/grid/subdiv'
import type { AppState, SelectionTransformKind, ToolActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ToolActionsSlice>

/**
 * Color-only flood write with just-in-time grid splits: when a grid division is armed,
 * fresh cells split first and the fill lands on every child of the editable slab (cube
 * semantics — floods never autotile or freeze shapes, matching the whole-voxel path);
 * whole grid writes unit voxels exactly as before. Runs inside the caller's producer.
 */
function floodFillCell(state: AppState, coord: Coord, slot: PaletteSlotRef) {
  const key = encodeKey(...coord)
  const gridSplit = state.pendingSplit
  if (gridSplit && !state.model.subdiv.has(key)) {
    if (!ensureSplitForPaint(state.model, coord, gridSplit, slot)) return
  }
  const sub = state.model.subdiv.get(key)
  if (sub) {
    const half = state.plane.half ?? frontSlabBit(state.plane.orientation)
    sub.children.forEach((_, i) => {
      if (childInSlab(sub.split, state.plane.axis, half, i)) paintSubCell(state.model, coord, i, slot)
    })
  } else {
    state.model.color.set(key, { paletteSlot: slot })
  }
}

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
        floodFillCell(state, coord, activePaletteSlot)
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
    // Half-step fills whole cubes — refused (subdivided voxels keep their flood via paint).
    if (plane.half !== null && !get().pendingSplit) {
      showToast('Half-step: only subdivided voxels are editable')
      return
    }
    const startCoord = gridCoordFromPixel(plane, u, v)
    if (!model.color.has(encodeKey(...startCoord))) return // only fills from an existing voxel
    const keys = floodFillRegion3D(model, startCoord, meta.gridExtent)
    if (keys.length === 0) return
    get().beginStroke()
    set((state) => {
      for (const key of keys) {
        floodFillCell(state, decodeKey(key), activePaletteSlot)
      }
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  floodFillCellsAt: (coord, alt) => {
    get().bakeFloatIfAny()
    const { model, activePaletteSlot, selectedCells, meta } = get()
    // Half-step fills whole cubes — refused (subdivided voxels keep their per-child edits).
    if (get().plane.half !== null && !get().pendingSplit) {
      showToast('Half-step: only subdivided voxels are editable')
      return
    }
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
          floodFillCell(state, decodeKey(key), activePaletteSlot)
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
        floodFillCell(state, c, activePaletteSlot)
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
    if (clipboard.fine && (clipboard.copyPlaneAxis !== plane.axis || clipboard.copyPlaneOrientation !== plane.orientation)) {
      // A sub-voxel copy is expressed in its source plane's frame; re-framing it is not built yet.
      showToast('Sub-voxel content can only be pasted onto the plane it was copied from')
      return
    }
    const transformedClipboard = transformClipboardToPlane(clipboard, plane)
    if (transformedClipboard.fine) {
      get().beginStroke()
      set((state) => {
        state.floatContent = transformedClipboard
        state.floatOrigin = { originU: u, originV: v, subU: 0, subV: 0 }
        state.selection = floatFootprintRegion(plane, transformedClipboard, u, v, 0, 0)
      })
      return
    }
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
    const { floatContent, plane } = get()
    if (!floatContent) return
    set((state) => {
      if (floatContent.fine) {
        // Sub-voxel float: the selection tracks the float's exact fine footprint.
        state.floatOrigin = { originU, originV, subU, subV }
        state.selection = floatFootprintRegion(plane, floatContent, originU, originV, subU, subV)
        return
      }
      state.floatOrigin = { originU, originV }
      state.selection = { ...state.selection!, originU, originV }
    })
  },

  moveFloatCellsTo: (originU, originV, subU = 0, subV = 0) => {
    // 3D exact-set moves: reposition the pending float without touching the 2D selection
    // (the 3D set tracks position separately — see the drop handler in Viewport3D.tsx).
    if (!get().floatContent) return
    set((state) => {
      state.floatOrigin = get().floatContent?.fine ? { originU, originV, subU, subV } : { originU, originV }
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
    if (transformedContent.fine) {
      // Sub-voxel float: rotate/mirror in place about its frame; the selection is its new footprint.
      const o = get().floatOrigin ?? { originU: transformedRegion.originU, originV: transformedRegion.originV }
      const plane = get().plane
      set((state) => {
        state.floatContent = transformedContent
        state.floatOrigin = { originU: o.originU, originV: o.originV, subU: o.subU ?? 0, subV: o.subV ?? 0 }
        state.selection = floatFootprintRegion(plane, transformedContent, o.originU, o.originV, o.subU ?? 0, o.subV ?? 0)
      })
      return
    }
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
      if (floatContent.fine) applyFineClipboardAt(state.model, plane, floatContent, floatOrigin.originU, floatOrigin.originV, floatOrigin.subU ?? 0, floatOrigin.subV ?? 0, meta.gridExtent)
      else applyClipboardAt(state.model, plane, floatContent, floatOrigin.originU, floatOrigin.originV, meta.gridExtent)
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
    // Same rebase as the 2D paste path so cross-plane pastes land on screen correctly.
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
        applyFineClipboardAt(state.model, fine3.plane, transformed, originU, originV, 0, 0, meta.gridExtent)
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
