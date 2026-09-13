import { useAppStore } from '@/store/useAppStore'
import type { EditorMode } from '@/store/types'

const MODES: Array<{ id: EditorMode; label: string }> = [
  { id: 'model', label: 'Model' },
  { id: 'animate', label: 'Animate' },
  { id: 'texture', label: 'Texture' },
]

/**
 * The top-level Model / Texture authoring-mode switch, sitting just right of the File menu. This is
 * the single UI entry point for `mode`; every mode-aware surface downstream reads `store.mode`
 * rather than being toggled from here.
 */
export function ModeTabs() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  return (
    <div data-tour="modes" role="tablist" aria-label="Authoring mode" className="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
      {MODES.map(({ id, label }) => {
        const active = mode === id
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => setMode(id)}
            onPointerEnter={() => setStatusMessage(id === 'model' ? 'Switch to voxel modeling mode' : 'Switch to texture painting mode')}
            onPointerLeave={() => setStatusMessage(null)}
            className={
              'rounded-md px-3 py-1 text-sm font-medium transition ' +
              (active ? 'bg-neutral-700 text-neutral-100 shadow' : 'text-neutral-400 hover:text-neutral-200')
            }
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
