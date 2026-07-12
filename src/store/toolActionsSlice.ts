import type { StateCreator } from 'zustand'
import { encodeKey, expandBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { floodFillRegion } from '@/engine/tools/floodFill'
import { applyClipboardAt, clearRegion, copyRegionToClipboard } from '@/engine/tools/clipboard'
import { mirrorClipboard, rotateClipboard90 } from '@/engine/tools/transform'
import { mirrorRegion, rotateRegion90 } from '@/engine/tools/selectionMask'
import type { AppState, ToolActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ToolActionsSlice>

// Invariant: every model-mutating action in this store must call `get().bakeFloatIfAny()` as its
// first line (before its own beginStroke()), so a pending float never gets silently dropped or
// desynced from the model. `undo`/`redo` (historySlice.ts) and `paintCell`/
// `eraseCell` (paintActions.ts) follow the same rule.
export const createToolActionsSlice: Slice = (set, get) => ({
  floodFill: (u, v) => {
    get().bakeFloatIfAny()
    const { model, plane, activePaletteSlot } = get()
    const cells = floodFillRegion(model, plane, u, v)
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

  cloneStampCell: (srcU, srcV, destU, destV) => {
    get().bakeFloatIfAny()
    const { model, plane } = get()
    const destCoord = gridCoordFromPixel(plane, destU, destV)
    if (!withinWorkingBounds(destCoord)) return
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

  pasteClipboardAt: (u, v) => {
    get().bakeFloatIfAny()
    const { clipboard } = get()
    if (!clipboard) return
    get().beginStroke()
    set((state) => {
      state.floatContent = clipboard
      state.floatOrigin = { originU: u, originV: v }
      state.selection = {
        originU: u,
        originV: v,
        width: clipboard.width,
        height: clipboard.height,
        mask: new Uint8Array(clipboard.width * clipboard.height).fill(1),
      }
    })
  },

  liftSelectionToFloat: () => {
    const { model, plane, selection, floatContent } = get()
    if (!selection || floatContent) return
    const content = copyRegionToClipboard(model, plane, selection)
    get().beginStroke()
    set((state) => {
      clearRegion(state.model, state.plane, selection)
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
    const transformedContent =
      kind === 'rotate' ? rotateClipboard90(floatContent) : mirrorClipboard(floatContent, kind === 'mirror-h' ? 'horizontal' : 'vertical')
    const transformedRegion = kind === 'rotate' ? rotateRegion90(selection) : mirrorRegion(selection, kind === 'mirror-h' ? 'horizontal' : 'vertical')
    set((state) => {
      state.floatContent = transformedContent
      state.floatOrigin = { originU: transformedRegion.originU, originV: transformedRegion.originV }
      state.selection = transformedRegion
    })
  },

  bakeFloatIfAny: () => {
    const { floatContent, floatOrigin, plane } = get()
    if (!floatContent || !floatOrigin) return
    set((state) => {
      applyClipboardAt(state.model, plane, floatContent, floatOrigin.originU, floatOrigin.originV)
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
