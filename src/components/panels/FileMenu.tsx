import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, FileDown, FilePlus, FileUp, Package } from 'lucide-react'
import { useRef, useState } from 'react'
import { readProjectFile, downloadProjectFile } from '@/engine/persistence/projectFile'
import { deserializeProject, serializeProject } from '@/engine/persistence/serialize'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'
import { ExportGltfDialog } from './ExportGltfDialog'

export function FileMenu() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [gltfDialogOpen, setGltfDialogOpen] = useState(false)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  function handleNew() {
    if (!confirm('Start a new project? Unsaved changes in this project will be lost from the autosave slot.')) return
    useAppStore.getState().newProject()
  }

  function handleExport() {
    const { model, palette, meta, texture, ambientOcclusion, noiseLevel, specularNoiseLevel, aoStrength, glassRoughnessLevel, exportScaleFactor, exportAnchor, animSettings } = useAppStore.getState()
    downloadProjectFile(serializeProject(model, palette, meta, texture, { ambientOcclusion, noiseLevel, specularNoiseLevel, aoStrength, glassRoughnessLevel, exportScaleFactor, exportAnchor }, animSettings))
    showToast('Project exported.')
  }

  async function handleImportFile(file: File) {
    try {
      const parsed = await readProjectFile(file)
      const { model, palette, meta, texture, view, animSettings } = deserializeProject(parsed)
      useAppStore.getState().setModel(model)
      useAppStore.getState().setPalette(palette)
      useAppStore.getState().setTexture(texture)
      useAppStore.setState((s) => {
        s.meta = meta
        s.ambientOcclusion = view.ambientOcclusion ?? false
        s.noiseLevel = view.noiseLevel ?? 0
        s.specularNoiseLevel = view.specularNoiseLevel ?? 0
        s.aoStrength = view.aoStrength ?? 1
        s.glassRoughnessLevel = view.glassRoughnessLevel ?? 0.3
        s.exportScaleFactor = view.exportScaleFactor ?? 100
        s.exportAnchor = view.exportAnchor ?? 'center'
        s.animSettings = animSettings
      })
      showToast('Project imported.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed.')
    }
  }

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
            onSelect={handleNew}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <FilePlus size={14} /> New Project
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={handleExport}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <FileDown size={14} /> Export Project (JSON)
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => fileInputRef.current?.click()}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <FileUp size={14} /> Import Project (JSON)
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-neutral-800" />
          <DropdownMenu.Item
            onSelect={() => setGltfDialogOpen(true)}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <Package size={14} /> Export GLTF…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImportFile(file)
          e.target.value = ''
        }}
      />
    </DropdownMenu.Root>
    <ExportGltfDialog open={gltfDialogOpen} onOpenChange={setGltfDialogOpen} />
    </>
  )
}
