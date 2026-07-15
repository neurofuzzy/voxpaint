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

/**
 * New Project modal: optional name + a locked-in-forever size (Small/Medium/Large). Replaces the
 * old bare `confirm()` + immediate reset — size can't be changed after creation (engine/grid/types.ts
 * `GridExtent`), so this is the one chance to pick it.
 */
export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState('')
  const [gridExtent, setGridExtent] = useState<GridExtent>(16)

  useEffect(() => {
    if (open) {
      setName('')
      setGridExtent(16)
    }
  }, [open])

  function create() {
    useAppStore.getState().newProject(name.trim() || 'Untitled Project', gridExtent)
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

            <div className="flex items-center gap-2">
              <span className="w-14 text-xs font-medium text-neutral-400 select-none">Size</span>
              <div className="flex flex-1 gap-1.5">
                {SIZE_OPTIONS.map(({ extent, label }) => {
                  const active = gridExtent === extent
                  return (
                    <button
                      key={extent}
                      onClick={() => setGridExtent(extent)}
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
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </Dialog.Close>
            <button
              onClick={create}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500"
            >
              Create
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
