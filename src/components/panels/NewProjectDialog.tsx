import * as Dialog from '@radix-ui/react-dialog'
import { FilePlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GridExtent } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'

const SIZE_OPTIONS: Array<{ extent: GridExtent; label: string }> = [
  { extent: 8, label: 'Small' },
  { extent: 16, label: 'Medium' },
  { extent: 24, label: 'Large' },
]

/** Inclusive range for a custom cube size. Odd values are allowed — internally they use the next
 * even grid, framed so the center column reads centered (see engine/grid/GridStore `effectiveExtent`
 * / `viewOriginShift`). Upper bound kept well under the technical `MAX_GRID_EXTENT` for performance. */
const CUSTOM_MIN = 2
const CUSTOM_MAX = 32

function parseCustom(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null
  const n = Number(text)
  return n >= CUSTOM_MIN && n <= CUSTOM_MAX ? n : null
}

/**
 * New Project modal: optional name + a locked-in-forever size. Offers the Small/Medium/Large presets
 * plus a Custom field for any edge length in [CUSTOM_MIN, CUSTOM_MAX], including odd sizes (which
 * give a centered pillar). Size can't be changed after creation (engine/grid/types.ts `GridExtent`),
 * so this is the one chance to pick it.
 */
export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<GridExtent | 'custom'>(16)
  const [customText, setCustomText] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setSelected(16)
      setCustomText('')
    }
  }, [open])

  const customExtent = parseCustom(customText)
  const isCustom = selected === 'custom'
  const effectiveExtent: GridExtent | null = isCustom ? customExtent : selected
  const canCreate = effectiveExtent !== null

  function create() {
    if (effectiveExtent === null) return
    useAppStore.getState().newProject(name.trim() || 'Untitled Project', effectiveExtent)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl
            border border-neutral-800 bg-neutral-900 p-5 text-neutral-200 shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
            <FilePlus size={18} /> New Project
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-400">
            Unsaved changes in the current project will be lost from the autosave slot. Size can't
            be changed later.
          </Dialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="project-name" className="w-14 text-xs font-medium text-neutral-400 select-none">
                Name
              </label>
              <input
                id="project-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') create() }}
                placeholder="Untitled Project"
                autoFocus
                className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1
                  text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>

            <div className="flex items-start gap-2">
              <span className="mt-1.5 w-14 text-xs font-medium text-neutral-400 select-none">Size</span>
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="flex gap-1.5">
                  {SIZE_OPTIONS.map(({ extent, label }) => {
                    const active = !isCustom && selected === extent
                    return (
                      <button
                        key={extent}
                        onClick={() => setSelected(extent)}
                        className={
                          'flex-1 rounded-md px-2 py-1.5 text-center transition ' +
                          (active
                            ? 'bg-violet-500/20 text-violet-300'
                            : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200')
                        }
                      >
                        <div className="text-xs font-medium">{label}</div>
                        <div className="font-mono text-[10px] tabular-nums opacity-70">{extent}³</div>
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setSelected('custom')}
                    className={
                      'flex-1 rounded-md px-2 py-1.5 text-center transition ' +
                      (isCustom
                        ? 'bg-violet-500/20 text-violet-300'
                        : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200')
                    }
                  >
                    <div className="text-xs font-medium">Custom</div>
                    <div className="font-mono text-[10px] tabular-nums opacity-70">
                      {customExtent !== null ? `${customExtent}³` : '—'}
                    </div>
                  </button>
                </div>

                {isCustom && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={CUSTOM_MIN}
                      max={CUSTOM_MAX}
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') create() }}
                      placeholder="e.g. 9"
                      autoFocus
                      className="w-20 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1
                        text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                    <span className="text-[11px] text-neutral-500">
                      edge length, {CUSTOM_MIN}–{CUSTOM_MAX} (odd sizes get a centered pillar)
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </Dialog.Close>
            <button
              onClick={create}
              disabled={!canCreate}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
