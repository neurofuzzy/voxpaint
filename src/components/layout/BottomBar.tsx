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
 * Bottom status bar, matching trixelart's Footer.tsx layout: undo/redo on the left, a short
 * tool-contextual info prompt in the middle (swaps per active tool, not a single giant static
 * shortcut list), global camera/selection hints on the right. Same height as the top toolbar.
 */
export function BottomBar() {
  const activeTool = useAppStore((s) => s.activeTool)

  return (
    <div className="flex h-11 items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-300">
      <UndoRedoControls />
      <div className="h-5 w-px bg-neutral-800" />
      <span className="truncate font-mono text-[11px] text-neutral-300">{TOOL_HINTS[activeTool]}</span>
      <div className="flex-1" />
      <span className="text-neutral-500">right-drag: pan · wheel/pinch: zoom · esc: deselect</span>
    </div>
  )
}
