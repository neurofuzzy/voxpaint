import { UndoRedoControls } from '@/components/panels/UndoRedoControls'
import { useAppStore } from '@/store/useAppStore'
import type { ToolId } from '@/store/types'

const TOOL_HINTS: Record<ToolId, string> = {
  paint: 'click or drag to paint · shift+drag: straight line · right-click: quick erase',
  erase: 'click or drag to erase · shift+drag: straight line',
  eyedropper: 'click to pick a color and voxel type',
  material: 'click or drag to repaint occupied voxels · never adds or deletes',
  select: 'drag to select · alt+drag: lasso · drag inside to move (alt: full depth)',
  wand: 'click a component for its color · re-tap it quickly for the whole component · drag inside to move · delete removes it at every depth',
  fill: 'click to flood-fill connected cells in 2d, ALT-click to flood fill in 3d',
  move: 'drag to shift every pixel on this slice',
  marker: 'click empty space to place a marker · tap a marker to recolor it, tap again to delete · drag to move',
  pivot: 'click to pin the rotation/pendulum pivot for this slice · right-click: clear',
  textureface: 'click or drag ramps, wedges + thin slabs to re-map their texture face to the current plane · geometry unchanged',
}

/** Appended to the tool hint in 3D-only layout (model mode), where the viewport edits directly. */
const LAYOUT_3D_HINTS: Partial<Record<ToolId, string>> = {
  paint: '3D: click faces to block',
  erase: '3D: click voxels to erase',
  eyedropper: '3D: click a voxel to pick its color and type',
  material: '3D: drag across faces',
}

/**
 * Bottom status bar: undo/redo on the left, a dynamic status message in the center (components
 * push contextual messages via `setStatusMessage`; falls back to the active tool hint when null),
 * and generic camera/selection hints on the right. Same height as the top toolbar.
 *
 * A selection-blocked alert (`statusAlert`, flashed when a 2D edit hits the selection clip)
 * takes precedence and blinks red — `key` on the span remounts it so repeat offenses retrigger
 * the animation (see `status-alert-blink` in index.css).
 */
export function BottomBar() {
  const activeTool = useAppStore((s) => s.activeTool)
  const statusMessage = useAppStore((s) => s.statusMessage)
  const statusAlert = useAppStore((s) => s.statusAlert)
  const mode = useAppStore((s) => s.mode)
  const layoutMode = useAppStore((s) => s.layoutMode)

  // 3D-only layout owns an independent voxel-set selection (see Selection3DSlice): the select
  // tool's plane-slice gestures (marquee rect, lasso, Alt depth) don't apply there.
  const selectHint = layoutMode === '3d-only' && mode === 'model' && activeTool === 'select'
    ? 'drag to marquee-select occupied voxels · drag inside to move · click for one voxel'
    : TOOL_HINTS[activeTool]
  // 3D-only model mode edits directly in the viewport — append the 3D gesture to the hint.
  const suffix = layoutMode === '3d-only' && mode === 'model' ? LAYOUT_3D_HINTS[activeTool] : undefined

  const defaultHint = mode === 'animate'
    ? (activeTool === 'paint'
        ? 'paint a mask to animate only part of this slice · leave unpainted to animate the whole slice'
        : activeTool === 'erase'
          ? 'erase mask cells · right-click: quick erase · unmark all to animate the whole slice again'
          : 'assign animation to the current slice · use construction plane to navigate')
    : suffix
      ? `${selectHint} · ${suffix}`
      : selectHint

  return (
    <div className="flex h-11 items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-2 py-0 text-xs text-neutral-300">
      <UndoRedoControls />
      <div className="h-5 w-px shrink-0 bg-neutral-800" />
      <span
        key={statusAlert ? `alert-${statusAlert.key}` : 'hint'}
        className={`flex-1 truncate text-center font-mono text-[11px] ${
          statusAlert ? 'status-alert-blink text-red-400' : 'text-neutral-300'
        }`}
      >
        {statusAlert?.message ?? statusMessage ?? defaultHint}
      </span>
    </div>
  )
}
