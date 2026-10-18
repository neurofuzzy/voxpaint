import * as Tooltip from '@radix-ui/react-tooltip'
import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { SelectionTransformKind } from '@/store/types'
import type { PaletteOrientation } from './FloatingPalette'

const ACTIONS: Array<{ id: string; label: string; icon: typeof RotateCw; hint: string; transform: SelectionTransformKind }> = [
  { id: 'rotate-cw', label: 'Rotate Model CW', icon: RotateCw, hint: 'rotate the entire model 90° clockwise in the active plane', transform: 'rotate' },
  { id: 'rotate-ccw', label: 'Rotate Model CCW', icon: RotateCcw, hint: 'rotate the entire model 90° counter-clockwise in the active plane', transform: 'rotate-ccw' },
  { id: 'mirror-h', label: 'Flip Model Horizontal', icon: FlipHorizontal, hint: 'mirror the entire model left-to-right in the active plane', transform: 'mirror-h' },
  { id: 'mirror-v', label: 'Flip Model Vertical', icon: FlipVertical, hint: 'mirror the entire model top-to-bottom in the active plane', transform: 'mirror-v' },
]

/**
 * Replaces the color palette while the Move tool is active (Model mode) — the Move tool never
 * paints, so there's nothing to pick a color for. Rotate/flip act on the entire model in the
 * active plane's frame as a single undo step each, with no selection left behind. Deliberately
 * button-only like SelectionPalette (a stray keypress must never mutate the model).
 */
export function MovePalette({ orientation = 'horizontal' }: { orientation?: PaletteOrientation } = {}) {
  const isEmpty = useAppStore((s) => s.model.color.size === 0)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const transformWholeModel = useAppStore((s) => s.transformWholeModel)
  const vertical = orientation === 'vertical'

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className={vertical ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1'}>
        {ACTIONS.map(({ id, label, icon: Icon, hint, transform }) => (
          <Tooltip.Root key={id}>
            <Tooltip.Trigger asChild>
              <button
                aria-label={label}
                disabled={isEmpty}
                onPointerEnter={() => setStatusMessage(hint)}
                onPointerLeave={() => setStatusMessage(null)}
                onClick={() => transformWholeModel(transform)}
                className={
                  'flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-700 ' +
                  'bg-neutral-800/60 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ' +
                  'text-neutral-200 enabled:hover:border-violet-400/60 enabled:hover:bg-violet-400/15 enabled:hover:text-violet-200'
                }
              >
                <Icon size={17} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side={vertical ? 'right' : 'top'}
                sideOffset={8}
                className="z-50 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 shadow-lg"
              >
                {label}
                <Tooltip.Arrow className="fill-neutral-700" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </div>
    </Tooltip.Provider>
  )
}
