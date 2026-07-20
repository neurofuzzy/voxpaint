import * as Tooltip from '@radix-ui/react-tooltip'
import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw, SquareDashed, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { SelectionTransformKind } from '@/store/types'

type Action = {
  id: string
  label: string
  icon: typeof RotateCw
  hint: string
  /** A float transform, or a one-off action run against the mode's own selection actions. */
  transform?: SelectionTransformKind
  run?: (a: SelectionActions) => void
  /** Set on the destructive actions so they read differently from the transforms. */
  danger?: boolean
}

type SelectionActions = {
  transformFloat: (kind: SelectionTransformKind) => void
  deleteContents: () => void
  clearSelection: () => void
}

const ACTIONS: Action[] = [
  { id: 'rotate-cw', label: 'Rotate CW', icon: RotateCw, hint: 'rotate the selection 90° clockwise · r', transform: 'rotate' },
  { id: 'rotate-ccw', label: 'Rotate CCW', icon: RotateCcw, hint: 'rotate the selection 90° counter-clockwise', transform: 'rotate-ccw' },
  { id: 'mirror-h', label: 'Flip Horizontal', icon: FlipHorizontal, hint: 'mirror the selection left-to-right · h', transform: 'mirror-h' },
  { id: 'mirror-v', label: 'Flip Vertical', icon: FlipVertical, hint: 'mirror the selection top-to-bottom · v', transform: 'mirror-v' },
  {
    id: 'delete',
    label: 'Delete Contents',
    icon: Trash2,
    hint: 'erase the voxels inside the selection, keeping the selection itself · delete',
    run: (a) => a.deleteContents(),
    danger: true,
  },
  {
    id: 'clear',
    label: 'Clear Selection',
    icon: SquareDashed,
    hint: 'drop the selection, leaving its contents in place · esc',
    run: (a) => a.clearSelection(),
    danger: true,
  },
]

/**
 * Replaces the color palette while the Select tool is active — the selection's own subtools
 * (rotate/flip/delete/clear), which otherwise only had keyboard bindings. Mode-aware in the same
 * way useKeyboardShortcuts.ts is: Texture mode drives the parallel texel-selection actions, which
 * have their own separate undo history.
 *
 * Every action needs something selected, so they're all disabled until there is a selection —
 * transforms would silently no-op otherwise (`transformFloat` bails when nothing lifts).
 */
export function SelectionPalette() {
  const isTexture = useAppStore((s) => s.mode === 'texture')
  const hasSelection = useAppStore((s) => (s.mode === 'texture' ? s.textureSelection : s.selection) !== null)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  const transformFloat = useAppStore((s) => (isTexture ? s.textureTransformFloat : s.transformFloat))
  const deleteContents = useAppStore((s) => (isTexture ? s.textureDelete : s.deleteSelection))
  // Both setters bake any pending float first, so clearing never strands lifted content.
  const setSelection = useAppStore((s) => (isTexture ? s.setTextureSelection : s.setSelection))

  const actions: SelectionActions = { transformFloat, deleteContents, clearSelection: () => setSelection(null) }

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-1">
        {ACTIONS.map(({ id, label, icon: Icon, hint, transform, run, danger }) => (
          <Tooltip.Root key={id}>
            <Tooltip.Trigger asChild>
              <button
                aria-label={label}
                disabled={!hasSelection}
                onPointerEnter={() => setStatusMessage(hint)}
                onPointerLeave={() => setStatusMessage(null)}
                onClick={() => {
                  if (transform) actions.transformFloat(transform)
                  else run?.(actions)
                }}
                className={
                  'flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-700 ' +
                  'bg-neutral-800/60 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ' +
                  (danger
                    ? 'text-neutral-300 enabled:hover:border-red-500/60 enabled:hover:bg-red-500/15 enabled:hover:text-red-300'
                    : 'text-neutral-200 enabled:hover:border-cyan-400/60 enabled:hover:bg-cyan-400/15 enabled:hover:text-cyan-200')
                }
              >
                <Icon size={17} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="top"
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
