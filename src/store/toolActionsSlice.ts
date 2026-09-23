import type { StateCreator } from 'zustand'
import { effectiveExtent, encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { rebaseChamferCell } from '@/engine/chamfer/faceBasis'
import { fillLeaksToEdges, floodFillRegion, floodFillRegion3D } from '@/engine/tools/floodFill'
import { applyClipboardAt, clearRegion, copyRegionToClipboard, transformClipboardToPlane } from '@/engine/tools/clipboard'
import { mirrorClipboard, rotateClipboard90 } from '@/engine/tools/transform'
import { forEachSelectedCell, isCellSelected, mirrorRegion, rotateRegion90 } from '@/engine/tools/selectionMask'
import type { AppState, ToolActionsSlice } from './types'

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
      if (fillLeaksToEdges(cells, meta.gridExtent)) return
      // An active selection clips the fill to its mask.
      if (selection) cells = cells.filter(([cu, cv]) => isCellSelected(selection, cu, cv))
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

  cloneStampCell: (srcU, srcV, destU, destV) => {
    get().bakeFloatIfAny()
    const { model, plane, meta } = get()
    const destCoord = gridCoordFromPixel(plane, destU, destV)
    if (!withinWorkingBounds(destCoord, meta.gridExtent)) return
    const srcKey = encodeKey(...gridCoordFromPixel(plane, srcU, srcV))
    const srcColor = model.color.get(srcKey)
    const srcChamfer = model.chamfer.get(srcKey)

    set((state) => {
      const destKey = encodeKey(...destCoord)
      if (!srcColor) {
        state.model.color.delete(destKey)
        state.model.chamfer.delete(destKey)
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
        return
      }

      state.model.color.set(destKey, { paletteSlot: srcColor.paletteSlot })
      // Clone/stamp reproduces the source voxel — its chamfer shape is copied verbatim, never
      // reclassified against the destination's neighbors (a chamfer only (re)resolves when the user
      // edits that specific voxel).
      if (srcChamfer) {
        state.model.chamfer.set(destKey, {
          planeAxis: srcChamfer.planeAxis,
          planeOrientation: srcChamfer.planeOrientation,
          resolvedTo: srcChamfer.resolvedTo ? { ...srcChamfer.resolvedTo } : null,
        })
      } else {
        state.model.chamfer.delete(destKey)
      }
      state.model.bounds = expandBounds(state.model.bounds, destCoord)
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
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
      // The selection mask is 2D but pasted walls span slices, so the footprint is projected
      // through the full depth along the plane normal — one shot faces the whole wall.
      const axisIdx = axisIndex(state.plane.axis)
      const half = effectiveExtent(state.meta.gridExtent) / 2
      forEachSelectedCell(selection, (u, v) => {
        const base = gridCoordFromPixel(state.plane, u, v)
        for (let d = -half; d < half; d++) {
          const coord: Coord = [base[0], base[1], base[2]]
          coord[axisIdx] = d
          const cell = state.model.chamfer.get(encodeKey(...coord))
          // Plain cubes sample texture by face normal — never mis-faced, silently ignored.
          if (!cell) continue
          if (rebaseChamferCell(cell, state.plane.axis, state.plane.orientation)) faced++
          else skipped++
        }
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
})
