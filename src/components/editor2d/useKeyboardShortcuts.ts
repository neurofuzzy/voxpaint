import { useEffect } from 'react'
import { effectiveExtent } from '@/engine/grid/GridStore'
import { rectRegion } from '@/engine/tools/selectionMask'
import { faceSizeFor, TEXEL_SCALE } from '@/engine/texture/types'
import { useAppStore } from '@/store/useAppStore'
import type { ToolId } from '@/store/types'

const TOOL_KEYS: Record<string, ToolId> = {
  p: 'paint',
  e: 'erase',
  i: 'eyedropper',
  m: 'material',
  t: 'textureface',
  s: 'select',
  k: 'fill',
  v: 'move',
  d: 'marker',
  w: 'wand',
  b: 'rigbox',
}

/**
 * Global keyboard shortcuts — undo/redo, select-all, copy/cut/paste, Escape-to-
 * deselect, and single-letter tool switching. One decoupled if-chain (matching
 * trixelart's own use-keyboard-shortcuts.ts), separate from tool pointer-dispatch since this is
 * app/selection-domain, not per-tool pointer logic.
 *
 * Deliberately no bare single-key transform shortcuts for the *selection*: selection
 * rotate/mirror live on the SelectionPalette buttons instead, so a stray keypress can never
 * reshape the model — only explicit Cmd-chord clipboard/undo commands and selection-gated Delete
 * may change it. `R` (brush rotation) is the one exception: it only changes what the *next* paint
 * writes, never existing voxels.
 *
 * Mode-aware: in Texture mode every selection/history action dispatches to the parallel texture
 * actions (its own separate undo/redo history and texel selection/clipboard). Tool switching is
 * shared. Called once from MainLayout (not the 2D canvases) so bindings stay live in 3D-only mode.
 *
 * Spring-loaded pivot (Animate mode): holding Alt with the rig tool active temporarily switches
 * to the pivot tool; releasing Alt restores the rig tool (see altPivotRestore below).
 */
let altPivotRestore: ToolId | null = null

function endAltPivotSwitch() {
  if (!altPivotRestore) return
  const store = useAppStore.getState()
  // Only restore when the switch is still in effect — a manual tool change mid-hold wins,
  // and a mode change mid-hold leaves the new mode's toolbar alone.
  if (store.mode === 'animate' && store.activeTool === 'pivot') store.setActiveTool(altPivotRestore)
  altPivotRestore = null
}
export function useKeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Spring-loaded pivot: lone Alt with the rig tool active (Animate mode) arms the pivot
      // tool until Alt releases. This sits above the INPUT/TEXTAREA guard on purpose: a lone
      // Alt press never produces text, so arming from inside a field (e.g. the rig-name input)
      // is harmless — it restores on keyup — and without this the switch silently fails there,
      // sending Alt+clicks to the rig tool instead of pinning. Guarded to a clean press (no
      // repeat, no chord) so Alt+arrows plane navigation just flickers the toolbar instead of
      // sticking.
      if (e.key.toLowerCase() === 'alt') {
        const store = useAppStore.getState()
        if (!e.repeat && !e.shiftKey && !e.ctrlKey && !e.metaKey && store.mode === 'animate' && store.activeTool === 'rigbox') {
          altPivotRestore = 'rigbox'
          store.setActiveTool('pivot')
          e.preventDefault()
        }
        return
      }

      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const store = useAppStore.getState()
      const isMeta = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // '?' opens the keyboard-shortcuts help from anywhere (mode-independent). Mirrored in the
      // Help dialog's shortcut list (components/onboarding/shortcuts.ts).
      if (e.key === '?') {
        store.openHelp()
        e.preventDefault()
        return
      }

      // Mode-specific bindings for a shared set of concepts, resolved up front so the rest of the
      // handler reads the same regardless of mode.
      const isTexture = store.mode === 'texture'
      const isAnimate = store.mode === 'animate'
      // 3D-only layout routes shared selection actions at the independent 3D voxel set;
      // split keeps the plane-framed 2D selection (see Selection3DSlice).
      const is3D = !isTexture && !isAnimate && store.layoutMode === '3d-only'
      const undo = isTexture ? store.textureUndo : isAnimate ? store.animUndo : store.undo
      const redo = isTexture ? store.textureRedo : isAnimate ? store.animRedo : store.redo
      const selection = isTexture ? store.textureSelection : isAnimate ? null : store.selection
      const clipboard = isTexture ? store.textureClipboard : isAnimate ? null : store.clipboard
      const copy = isTexture ? store.textureCopy : store.copySelection
      const cut = isTexture ? store.textureCut : store.cutSelection
      const bakeFloat = isTexture ? store.textureBakeFloatIfAny : store.bakeFloatIfAny
      const clearSelection = isTexture ? () => store.setTextureSelection(null) : () => store.setSelection(null)
      const deleteSelection = isTexture ? store.textureDelete : store.deleteSelection

      if (isMeta) {
        if (key === 'z') {
          if (e.shiftKey) redo()
          else undo()
          e.preventDefault()
        } else if (key === 'a' && !isAnimate) {
          // Select-all: the full plane span in Model mode (logical (u,v) run over the even
          // effective grid, symmetric about the origin), the whole face in Texture mode.
          // setSelection bakes any pending float first, like every other selection change.
          if (isTexture) {
            const faceSize = faceSizeFor(store.meta.gridExtent, store.meta.texelScale ?? TEXEL_SCALE)
            store.setTextureSelection(rectRegion(0, 0, faceSize - 1, faceSize - 1))
          } else if (is3D) {
            // 3D-only: every occupied voxel, as an explicit set (no plane frame involved).
            store.setSelectedCells(new Set(store.model.color.keys()))
          } else {
            const half = effectiveExtent(store.meta.gridExtent) / 2
            store.setSelection(rectRegion(-half, -half, half - 1, half - 1))
          }
          e.preventDefault()
        } else if (key === 'c' && (is3D ? store.selectedCells.size > 0 : selection)) {
          if (is3D) store.copyCells3D()
          else copy()
          e.preventDefault()
        } else if (key === 'x' && (is3D ? store.selectedCells.size > 0 : selection)) {
          if (is3D) store.cutCells3D()
          else cut()
          e.preventDefault()
        } else if (key === 'v' && clipboard) {
          // Paste-in-place. In voxel mode "in place" means the same spot *on screen*, so the store
          // rebases the origin for the active plane; texture mode has no planes and pastes at the
          // literal copied origin. 3D-only stamps directly (no 2D float to drag there) and
          // selects the pasted cells.
          if (isTexture) store.texturePasteAt(clipboard.originU ?? 0, clipboard.originV ?? 0)
          else if (is3D) store.pasteCells3D()
          else store.pasteClipboardInPlace()
          e.preventDefault()
        }
        return
      }

      if (e.key === 'Escape') {
        bakeFloat()
        clearSelection()
        // The 3D store is independent — clear it too (no-op when empty, which is always the
        // case outside model-mode 3D gestures).
        store.clearSelectedCells()
        if (!isTexture && !isAnimate) store.selectMarker(null)
        e.preventDefault()
        return
      }

      // (Spring-loaded pivot lives at the top of this handler, above the INPUT guard.)

      if (e.altKey) {
        if (key === 'arrowup') {
          store.setPlaneOffset(store.plane.offset + 1)
          e.preventDefault()
          return
        }
        if (key === 'arrowdown') {
          store.setPlaneOffset(store.plane.offset - 1)
          e.preventDefault()
          return
        }
        if (key === 'arrowleft' || key === 'arrowright') {
          const cycle: [typeof store.plane.axis, typeof store.plane.orientation][] = [
            ['x', 1], ['x', -1],
            ['y', 1], ['y', -1],
            ['z', 1], ['z', -1],
          ]
          const idx = cycle.findIndex(([a, o]) => a === store.plane.axis && o === store.plane.orientation)
          const off = key === 'arrowright' ? 1 : -1
          const next = (idx + off + cycle.length) % cycle.length
          store.setPlaneAxisOrientation(...cycle[next])
          e.preventDefault()
          return
        }
      }

      if ((key === 'delete' || key === 'backspace') && (is3D ? store.selectedCells.size > 0 : selection)) {
        if (is3D) store.deleteCells3D()
        else deleteSelection()
        e.preventDefault()
        return
      }

      // Delete/Backspace with no voxel selection removes the selected design marker (if any).
      if ((key === 'delete' || key === 'backspace') && !isTexture && !isAnimate && store.selectedMarkerId) {
        store.deleteMarker(store.selectedMarkerId)
        e.preventDefault()
        return
      }

      const tool = TOOL_KEYS[key]
      // Animate mode's toolbar is rigbox + pivot only — other tool letters stay inert there
      // rather than switching to a tool with no animate-mode handler.
      if (tool && (!isAnimate || tool === 'pivot' || tool === 'rigbox')) {
        store.setActiveTool(tool)
        e.preventDefault()
        return
      }

      // Brush rotation: R steps +90°, Shift+R steps −90°. Model mode only (kind has no meaning
      // while texturing/animating). Changes only the next paint, never existing voxels.
      if (key === 'r' && !isTexture && !isAnimate) {
        store.rotateBrush(e.shiftKey ? -1 : 1)
        e.preventDefault()
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'alt') endAltPivotSwitch()
    }

    function onBlur() {
      // Alt released off-window (Alt+Tab) never fires keyup — restore without sticking.
      endAltPivotSwitch()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      // Unmount with Alt held must not leak the armed restore into the next mount.
      altPivotRestore = null
    }
  }, [])
}
