import { UndoRedoControls } from '@/components/panels/UndoRedoControls'
import { useAppStore } from '@/store/useAppStore'
import type { ToolId } from '@/store/types'

const TOOL_HINTS: Record<ToolId, string> = {
  paint: 'click or drag to paint · shift+drag: straight line · right-click: quick erase',
  erase: 'click or drag to erase · shift+drag: straight line',
  eyedropper: 'click to pick a color',
  select: 'drag to select · alt+drag: lasso · drag inside a selection to move it',
  fill: 'click to flood-fill connected cells in 2d, ALT-click to flood fill in 3d',
  clone: 'alt+click to set a clone source, then drag to stamp',
  move: 'drag to shift every pixel on this slice · r/h/v: rotate/mirror',
  pivot: 'click to pin the rotation/pendulum pivot for this slice · right-click: clear',
}

/**
 * Bottom status bar: undo/redo on the left, a dynamic status message in the center (components
 * push contextual messages via `setStatusMessage`; falls back to the active tool hint when null),
 * and generic camera/selection hints on the right. Same height as the top toolbar.
 */
export function BottomBar() {
  const activeTool = useAppStore((s) => s.activeTool)
  const statusMessage = useAppStore((s) => s.statusMessage)
  const mode = useAppStore((s) => s.mode)

  const defaultHint = mode === 'animate'
    ? (activeTool === 'paint'
        ? 'paint a mask to animate only part of this slice · leave unpainted to animate the whole slice'
        : activeTool === 'erase'
          ? 'erase mask cells · right-click: quick erase · unmark all to animate the whole slice again'
          : 'assign animation to the current slice · use construction plane to navigate')
    : TOOL_HINTS[activeTool]

  return (
    <div className="flex h-11 items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-2 py-0 text-xs text-neutral-300">
      <UndoRedoControls />
      <div className="h-5 w-px shrink-0 bg-neutral-800" />
      <span className="flex-1 truncate text-center font-mono text-[11px] text-neutral-300">
        {statusMessage ?? defaultHint}
      </span>
    </div>
  )
}
