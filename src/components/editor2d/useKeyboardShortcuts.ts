import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { ToolId } from '@/store/types'

const TOOL_KEYS: Record<string, ToolId> = {
  p: 'paint',
  e: 'erase',
  i: 'eyedropper',
  s: 'select',
  f: 'fill',
  c: 'clone',
  m: 'move',
}

/**
 * Global keyboard shortcuts — undo/redo, copy/cut/paste, delete-selection-contents, Escape-to-
 * deselect, rotate/mirror, and single-letter tool switching. One decoupled if-chain (matching
 * trixelart's own use-keyboard-shortcuts.ts), separate from tool pointer-dispatch since this is
 * app/selection-domain, not per-tool pointer logic.
 *
 * Mode-aware: in Texture mode every selection/history action dispatches to the parallel texture
 * actions (its own separate undo/redo history and texel selection/clipboard). Tool switching is
 * shared. Called from whichever 2D canvas is mounted (only one at a time), so a single listener is
 * ever active.
 */
export function useKeyboardShortcuts(hoverCellRef?: React.RefObject<[number, number] | null>) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
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
      const undo = isTexture ? store.textureUndo : isAnimate ? store.animUndo : store.undo
      const redo = isTexture ? store.textureRedo : isAnimate ? store.animRedo : store.redo
      const selection = isTexture ? store.textureSelection : isAnimate ? null : store.selection
      const clipboard = isTexture ? store.textureClipboard : isAnimate ? null : store.clipboard
      const copy = isTexture ? store.textureCopy : store.copySelection
      const cut = isTexture ? store.textureCut : store.cutSelection
      const pasteAt = isTexture ? store.texturePasteAt : store.pasteClipboardAt
      const bakeFloat = isTexture ? store.textureBakeFloatIfAny : store.bakeFloatIfAny
      const clearSelection = isTexture ? () => store.setTextureSelection(null) : () => store.setSelection(null)
      const deleteSelection = isTexture ? store.textureDelete : store.deleteSelection
      const transformFloat = isTexture ? store.textureTransformFloat : store.transformFloat

      if (isMeta) {
        if (key === 'z') {
          if (e.shiftKey) redo()
          else undo()
          e.preventDefault()
        } else if (key === 'c' && selection) {
          copy()
          e.preventDefault()
        } else if (key === 'x' && selection) {
          cut()
          e.preventDefault()
        } else if (key === 'v' && clipboard) {
          // Paste-in-place: always land at the same top-left the selection was copied from.
          pasteAt(clipboard.originU ?? 0, clipboard.originV ?? 0)
          e.preventDefault()
        }
        return
      }

      if (e.key === 'Escape') {
        bakeFloat()
        clearSelection()
        e.preventDefault()
        return
      }

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

      if ((key === 'delete' || key === 'backspace') && selection) {
        deleteSelection()
        e.preventDefault()
        return
      }

      // Rotate/mirror apply to whatever is selected regardless of the active tool.
      if (selection && !isAnimate) {
        if (key === 'r') {
          transformFloat('rotate')
          e.preventDefault()
          return
        } else if (key === 'h') {
          transformFloat('mirror-h')
          e.preventDefault()
          return
        } else if (key === 'v') {
          transformFloat('mirror-v')
          e.preventDefault()
          return
        }
      }

      const tool = TOOL_KEYS[key]
      // Animate mode's toolbar only has paint/erase (mask) and pivot (no letter shortcut) — other
      // tool letters stay inert there rather than switching to a tool with no animate-mode handler.
      if (tool && (!isAnimate || tool === 'paint' || tool === 'erase')) {
        store.setActiveTool(tool)
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hoverCellRef])
}
