import * as Tooltip from '@radix-ui/react-tooltip'
import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw, SquareArrowOutDownLeft, SquareDashed, Trash2 } from 'lucide-react'
import { showToast } from '@/components/ui/toastBus'
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
  /** Voxel-model-only actions are hidden in Texture mode (no chamfer basis to re-face there). */
  modelOnly?: boolean
}

type SelectionActions = {
  transformFloat: (kind: SelectionTransformKind) => void
  deleteContents: () => void
  clearSelection: () => void
  faceSelection: () => { faced: number; skipped: number }
  faceDir: string
}

const FACE_DIRS: Record<string, Record<number, string>> = {
  x: { 1: 'east', '-1': 'west' },
  y: { 1: 'up', '-1': 'down' },
  z: { 1: 'south', '-1': 'north' },
}

function faceToast({ faced, skipped }: { faced: number; skipped: number }, dir: string): void {
  if (faced === 0 && skipped === 0) {
    showToast('Nothing to face — the selection holds no angled or thin voxels.')
  } else if (faced === 0) {
    showToast(`Already facing ${dir} — ${skipped} cell${skipped === 1 ? '' : 's'} needed no change or can't be faced.`)
  } else if (skipped === 0) {
    showToast(`Faced ${faced} voxel${faced === 1 ? '' : 's'} ${dir}.`)
  } else {
    showToast(`Faced ${faced} voxel${faced === 1 ? '' : 's'} ${dir} — ${skipped} left alone (corners or already faced).`)
  }
}

const ACTIONS: Action[] = [
  { id: 'rotate-cw', label: 'Rotate CW', icon: RotateCw, hint: 'rotate the selection 90° clockwise', transform: 'rotate' },
  { id: 'rotate-ccw', label: 'Rotate CCW', icon: RotateCcw, hint: 'rotate the selection 90° counter-clockwise', transform: 'rotate-ccw' },
  { id: 'mirror-h', label: 'Flip Horizontal', icon: FlipHorizontal, hint: 'mirror the selection left-to-right', transform: 'mirror-h' },
  { id: 'mirror-v', label: 'Flip Vertical', icon: FlipVertical, hint: 'mirror the selection top-to-bottom', transform: 'mirror-v' },
  {
    id: 'face',
    label: 'Face Selection',
    icon: SquareArrowOutDownLeft,
    hint: 're-face every ramp, wedge, thin, and unshaped voxel in the selection onto the active construction plane, so pasted walls sample the right texture face · geometry unchanged',
    run: (a) => faceToast(a.faceSelection(), a.faceDir),
    modelOnly: true,
  },
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
 * (rotate/flip/delete/clear). These deliberately have no keyboard shortcuts (a stray keypress
 * must never mutate the model), so these buttons are the only path. Mode-aware in the same
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
  const plane = useAppStore((s) => s.plane)

  const transformFloat = useAppStore((s) => (isTexture ? s.textureTransformFloat : s.transformFloat))
  const deleteContents = useAppStore((s) => (isTexture ? s.textureDelete : s.deleteSelection))
  // Both setters bake any pending float first, so clearing never strands lifted content.
  const setSelection = useAppStore((s) => (isTexture ? s.setTextureSelection : s.setSelection))
  const faceSelection = useAppStore((s) => s.faceSelection)

  const faceDir = FACE_DIRS[plane.axis]?.[plane.orientation] ?? plane.axis
  const actions: SelectionActions = { transformFloat, deleteContents, clearSelection: () => setSelection(null), faceSelection, faceDir }
  const visible = ACTIONS.filter((a) => !a.modelOnly || !isTexture)

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-1">
        {visible.map(({ id, label, icon: Icon, hint, transform, run, danger }) => (
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
