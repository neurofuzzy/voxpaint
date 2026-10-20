import { ChevronRight } from 'lucide-react'
import { FloatingPalette } from '@/components/panels/FloatingPalette'
import { useAppStore } from '@/store/useAppStore'

/**
 * Slim secondary sidebar shown in place of the 2D editor while it is collapsed (3D-only mode).
 * Same width/chrome as the tool `LeftPanel`. The chevron re-expands the editor; below it sits
 * the same palette the bottom-center pill would have shown (colors, selection/move subtools,
 * grayscale, marker colors, or animation controls, per tool+mode) restacked vertically — the
 * live palette, not a copy, so only one `FloatingPalette` is ever mounted.
 *
 * Carries the editor's `data-tour` target so the onboarding tour still finds the pane slot
 * while collapsed.
 */
export function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  return (
    <div data-tour="editor2d" className="flex w-14 shrink-0 flex-col items-center border-r border-neutral-800 bg-neutral-900 py-2">
      <button
        onClick={onExpand}
        aria-label="Expand 2D editor"
        title="Expand the 2D editor (back to 2D/3D split)"
        onPointerEnter={() => setStatusMessage('Expand the 2D editor — back to the 2D/3D split view')}
        onPointerLeave={() => setStatusMessage(null)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      >
        <ChevronRight size={16} />
      </button>
      <div className="mx-2 my-2 w-8 border-t border-neutral-800" />
      {/* w-full: the column must span the rail, or the scroll box shrink-wraps to swatch width
        and clips rings/scaled halos on both sides. */}
      <div className="min-h-0 w-full flex-1 overflow-y-auto">
        <FloatingPalette orientation="vertical" />
      </div>
    </div>
  )
}
