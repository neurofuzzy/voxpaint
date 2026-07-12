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
 */
export function useKeyboardShortcuts(hoverCellRef: React.RefObject<[number, number] | null>) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const store = useAppStore.getState()
      const isMeta = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (isMeta) {
        if (key === 'z') {
          if (e.shiftKey) store.redo()
          else store.undo()
          e.preventDefault()
        } else if (key === 'c' && store.selection) {
          store.copySelection()
          e.preventDefault()
        } else if (key === 'x' && store.selection) {
          store.cutSelection()
          e.preventDefault()
        } else if (key === 'v' && store.clipboard) {
          // Paste-in-place: always land at the same top-left the selection was copied from.
          store.pasteClipboardAt(store.clipboard.originU ?? 0, store.clipboard.originV ?? 0)
          e.preventDefault()
        }
        return
      }

      if (e.key === 'Escape') {
        store.bakeFloatIfAny()
        store.setSelection(null)
        e.preventDefault()
        return
      }

      if ((key === 'delete' || key === 'backspace') && store.selection) {
        store.deleteSelection()
        e.preventDefault()
        return
      }

      // Rotate/mirror apply to whatever is selected regardless of the active tool — both Select
      // (dragging inside a selection) and Move (whole-slice) can leave a transformable float/
      // selection behind, so this isn't scoped to a specific tool.
      if (store.selection) {
        if (key === 'r') {
          store.transformFloat('rotate')
          e.preventDefault()
          return
        } else if (key === 'h') {
          store.transformFloat('mirror-h')
          e.preventDefault()
          return
        } else if (key === 'v') {
          store.transformFloat('mirror-v')
          e.preventDefault()
          return
        }
      }

      const tool = TOOL_KEYS[key]
      if (tool) {
        store.setActiveTool(tool)
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hoverCellRef])
}
