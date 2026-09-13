import * as Dialog from '@radix-ui/react-dialog'
import { FilePlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GridExtent } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'
import { ProjectSizePicker } from './ProjectSizePicker'
import { parseCustomSize } from './projectSizeOptions'

/**
 * New Project modal: optional name + a locked-in-at-creation size. Offers the Small/Medium/Large
 * presets plus a Custom field for any edge length in [CUSTOM_MIN, CUSTOM_MAX], including odd sizes
 * (which give a centered pillar). The size can still be changed later in Project Settings
 * (shrinking deletes out-of-bounds voxels), so this is just the starting point.
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

  const customExtent = parseCustomSize(customText)
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
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl
            border border-neutral-800 bg-neutral-900 p-7 text-neutral-200 shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
            <FilePlus size={22} /> New Project
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-neutral-400">
            Unsaved changes in the current project will be lost from the autosave slot. Size can
            be changed later in Project Settings.
          </Dialog.Description>

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <label htmlFor="project-name" className="w-18 text-sm font-medium text-neutral-400 select-none">
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
                className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5
                  text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>

            <ProjectSizePicker
              selected={selected}
              customText={customText}
              onSelect={setSelected}
              onCustomTextChange={setCustomText}
              onCommit={create}
            />
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="rounded-md px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </Dialog.Close>
            <button
              onClick={create}
              disabled={!canCreate}
              className="rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
