import { UndoRedoControls } from '@/components/panels/UndoRedoControls'
import { useAppStore } from '@/store/useAppStore'
import type { ToolId } from '@/store/types'

const TOOL_HINTS: Record<ToolId, string> = {
  paint: 'click or drag to paint · shift+drag: straight line · right-click: quick erase',
  erase: 'click or drag to erase · shift+drag: straight line',
  eyedropper: 'click to pick a color',
  select: 'drag to select · alt+drag: lasso · drag inside a selection to move it',
  fill: 'click to flood-fill connected cells',
  clone: 'alt+click to set a clone source, then drag to stamp',
  move: 'drag to shift every pixel on this slice · r/h/v: rotate/mirror',
}

/**
 * Bottom status bar: undo/redo on the left, a dynamic status message in the center (components
 * push contextual messages via `setStatusMessage`; falls back to the active tool hint when null),
 * and generic camera/selection hints on the right. Same height as the top toolbar.
 */
export function BottomBar() {
  const activeTool = useAppStore((s) => s.activeTool)
  const statusMessage = useAppStore((s) => s.statusMessage)

  return (
    <div className="flex h-11 items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-2 py-0 text-xs text-neutral-300">
      <UndoRedoControls />
      <div className="h-5 w-px shrink-0 bg-neutral-800" />
      <span className="flex-1 truncate text-center font-mono text-[11px] text-neutral-300">
        {statusMessage ?? TOOL_HINTS[activeTool]}
      </span>
    </div>
  )
}
