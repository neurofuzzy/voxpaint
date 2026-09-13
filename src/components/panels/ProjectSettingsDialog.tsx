import * as Dialog from '@radix-ui/react-dialog'
import { Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { countCellsOutsideBounds } from '@/engine/grid/GridStore'
import type { GridExtent } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'
import { ProjectSizePicker } from './ProjectSizePicker'
import { SIZE_OPTIONS, parseCustomSize } from './projectSizeOptions'

/**
 * Project Settings modal: rename the project and/or resize its working cube. Mirrors the New
 * Project dialog's name + size controls, prefilled with the current values. Growing keeps
 * everything; shrinking deletes voxels outside the new bounds (warned with an exact count, and
 * reported on save) and center-crops the texture faces, and any resize clears undo history.
 */
export function ProjectSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const currentName = useAppStore((s) => s.meta.name)
  const currentExtent = useAppStore((s) => s.meta.gridExtent)
  const model = useAppStore((s) => s.model)

  const [name, setName] = useState(currentName)
  const [selected, setSelected] = useState<GridExtent | 'custom'>(currentExtent)
  const [customText, setCustomText] = useState('')

  useEffect(() => {
    if (open) {
      const state = useAppStore.getState()
      setName(state.meta.name)
      if (SIZE_OPTIONS.some(({ extent }) => extent === state.meta.gridExtent)) {
        setSelected(state.meta.gridExtent)
        setCustomText('')
      } else {
        setSelected('custom')
        setCustomText(String(state.meta.gridExtent))
      }
    }
  }, [open])

  const customExtent = parseCustomSize(customText)
  const isCustom = selected === 'custom'
  const nextExtent: GridExtent | null = isCustom ? customExtent : selected
  const trimmedName = name.trim() || 'Untitled Project'
  const nameChanged = trimmedName !== currentName
  const sizeChanged = nextExtent !== null && nextExtent !== currentExtent
  const canSave = nextExtent !== null && (nameChanged || sizeChanged)

  // Voxels the new size would delete. Only meaningful when shrinking.
  const doomed =
    nextExtent !== null && nextExtent < currentExtent ? countCellsOutsideBounds(model, nextExtent) : 0

  function save() {
    if (nextExtent === null || !canSave) return
    useAppStore.getState().updateProjectSettings(trimmedName, nextExtent)
    if (doomed > 0) {
      showToast(`Project resized to ${nextExtent}³ — ${doomed} voxel${doomed === 1 ? '' : 's'} removed.`)
    }
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
            <Settings size={22} /> Project Settings
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-neutral-400">
            Currently {currentExtent}³. Growing keeps everything; shrinking deletes voxels outside
            the new bounds and clears undo history.
          </Dialog.Description>

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <label htmlFor="settings-name" className="w-18 text-sm font-medium text-neutral-400 select-none">
                Name
              </label>
              <input
                id="settings-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save() }}
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
              onCommit={save}
            />

            {sizeChanged && (
              <p className="text-xs text-neutral-500">
                Texture faces are center-{nextExtent! < currentExtent ? 'cropped' : 'padded'} to the new size.
              </p>
            )}
            {doomed > 0 && (
              <p className="rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                Shrinking to {nextExtent}³ will permanently delete {doomed} voxel{doomed === 1 ? '' : 's'} outside
                the new bounds. This can't be undone.
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="rounded-md px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </Dialog.Close>
            <button
              onClick={save}
              disabled={!canSave}
              className="rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
