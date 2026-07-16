import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, FilePlus, FolderOpen, Package, Printer, Save } from 'lucide-react'
import { useState } from 'react'
import { openProject, saveProject, saveProjectAs } from '@/store/projectFileActions'
import { useAppStore } from '@/store/useAppStore'
import { ExportGltfDialog } from './ExportGltfDialog'
import { ExportStlDialog } from './ExportStlDialog'
import { NewProjectDialog } from './NewProjectDialog'

export function FileMenu() {
  const [gltfDialogOpen, setGltfDialogOpen] = useState(false)
  const [stlDialogOpen, setStlDialogOpen] = useState(false)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const newProjectDialogOpen = useAppStore((s) => s.newProjectDialogOpen)
  const openNewProjectDialog = useAppStore((s) => s.openNewProjectDialog)
  const closeNewProjectDialog = useAppStore((s) => s.closeNewProjectDialog)

  return (
    <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          onPointerEnter={() => setStatusMessage('Open the file menu')}
          onPointerLeave={() => setStatusMessage(null)}
        >
          File
          <ChevronDown size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-48 rounded-md border border-neutral-800 bg-neutral-900 p-1 text-sm text-neutral-200 shadow-xl"
        >
          <DropdownMenu.Item
            onSelect={openNewProjectDialog}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <FilePlus size={14} /> New Project…
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void saveProject()}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <Save size={14} /> Save Project
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void saveProjectAs()}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <Save size={14} /> Save Project As…
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void openProject()}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <FolderOpen size={14} /> Open Project…
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-neutral-800" />
          <DropdownMenu.Item
            onSelect={() => setGltfDialogOpen(true)}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <Package size={14} /> Export GLTF…
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => setStlDialogOpen(true)}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <Printer size={14} /> Export STL…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <ExportGltfDialog open={gltfDialogOpen} onOpenChange={setGltfDialogOpen} />
    <ExportStlDialog open={stlDialogOpen} onOpenChange={setStlDialogOpen} />
    <NewProjectDialog
      open={newProjectDialogOpen}
      onOpenChange={(v) => (v ? openNewProjectDialog() : closeNewProjectDialog())}
    />
    </>
  )
}
