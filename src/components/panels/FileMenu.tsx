import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, FileDown, FilePlus, FileUp, Package, Printer } from 'lucide-react'
import { useRef, useState } from 'react'
import { readProjectFile, downloadProjectFile } from '@/engine/persistence/projectFile'
import { deserializeProject, serializeProject } from '@/engine/persistence/serialize'
import { isIPad } from '@/engine/input/isIPad'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'
import { ExportGltfDialog } from './ExportGltfDialog'
import { ExportStlDialog } from './ExportStlDialog'
import { NewProjectDialog } from './NewProjectDialog'
import type { CellKey } from '@/engine/grid/types'

export function FileMenu() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [gltfDialogOpen, setGltfDialogOpen] = useState(false)
  const [stlDialogOpen, setStlDialogOpen] = useState(false)
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  function handleExport() {
    const { model, palette, meta, texture, ambientOcclusion, noiseLevel, specularNoiseLevel, noiseScale, aoStrength, glassRoughnessLevel, exposure, exportScaleFactor, exportAnchor, exportAlignToObjectBounds, exportIncludeTextureMaps, exportIncludeAOMaps, exportIncludeMarkers, exportIncludeAnimations, animSettings, sliceMasks, slicePivots, markers, rigBoxes, poses, poseCycle } = useAppStore.getState()
    downloadProjectFile(serializeProject(model, palette, meta, texture, { ambientOcclusion, noiseLevel, specularNoiseLevel, noiseScale, aoStrength, glassRoughnessLevel, exposure, exportScaleFactor, exportAnchor, exportAlignToObjectBounds, exportIncludeTextureMaps, exportIncludeAOMaps, exportIncludeMarkers, exportIncludeAnimations }, animSettings, sliceMasks, slicePivots, markers, rigBoxes, poses, poseCycle))
    showToast('Project exported.')
  }

  async function handleImportFile(file: File) {
    try {
      const parsed = await readProjectFile(file)
      const { model, palette, meta, texture, view, animSettings, sliceMasks, slicePivots, markers, rigBoxes, poses, poseCycle } = deserializeProject(parsed)
      // Same project-switch hygiene as newProject: abandon open strokes (a pending float belongs
      // to the old model) rather than baking them into the imported one.
      useAppStore.getState().cancelStroke()
      useAppStore.getState().textureCancelStroke()
      useAppStore.getState().animCancelStroke()
      useAppStore.getState().setModel(model)
      useAppStore.getState().setPalette(palette)
      useAppStore.getState().setTexture(texture)
      useAppStore.setState((s) => {
        s.meta = meta
        // Stale selection/float/hover reference the old project's cells — reset (clipboards kept).
        s.selection = null
        s.selectedCells = new Set<CellKey>()
        s.floatContent = null
        s.floatOrigin = null
        s.hoverCell = null
        s.chamferHoverValid = null
        s.hoveredFace = null
        s.paintLineAnchor = null
        s.textureSelection = null
        s.textureFloat = null
        s.textureFloatOrigin = null
        // Undo histories belong to the old project — an undo right after import must not resurrect it.
        s.past = []
        s.future = []
        s.texturePast = []
        s.textureFuture = []
        s.ambientOcclusion = view.ambientOcclusion ?? false
        s.noiseLevel = view.noiseLevel ?? 0
        s.specularNoiseLevel = view.specularNoiseLevel ?? 0
        s.noiseScale = view.noiseScale === 2 || view.noiseScale === 4 ? view.noiseScale : 1
        s.aoStrength = view.aoStrength ?? 1
        s.glassRoughnessLevel = view.glassRoughnessLevel ?? 0.3
        s.exposure = view.exposure ?? 1
        s.exportScaleFactor = view.exportScaleFactor ?? 100
        s.exportAnchor = view.exportAnchor ?? 'center'
        s.exportAlignToObjectBounds = view.exportAlignToObjectBounds ?? false
        s.exportIncludeTextureMaps = view.exportIncludeTextureMaps ?? true
        s.exportIncludeAOMaps = view.exportIncludeAOMaps ?? true
        s.exportIncludeMarkers = view.exportIncludeMarkers ?? true
        s.exportIncludeAnimations = view.exportIncludeAnimations ?? true
        s.animSettings = animSettings
        s.sliceMasks = sliceMasks
        s.slicePivots = slicePivots
        s.animPast = []
        s.animFuture = []
        s.markers = markers
        s.selectedMarkerId = null
        s.rigBoxes = rigBoxes
        s.selectedRigBoxId = null
        // Poses persist with the project; staging and transport reset (session-only).
        s.poses = poses
        s.poseCycle = poseCycle
        s.stagedPoseId = null
        s.cyclePlaying = false
      })
      // An imported project opens grounded — one project's slice never leaks into the next.
      useAppStore.getState().resetPlaneToGround()
      showToast('Project imported.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  return (
    <>
    <DropdownMenu.Root modal={!isIPad() /* non-modal on iPad: modal Radix overlays swallow Apple Pencil taps */}>
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
            onSelect={() => setNewProjectDialogOpen(true)}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <FilePlus size={14} /> New Project…
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
          <DropdownMenu.Item
            onSelect={() => setStlDialogOpen(true)}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
          >
            <Printer size={14} /> Export STL…
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
    <ExportStlDialog open={stlDialogOpen} onOpenChange={setStlDialogOpen} />
    <NewProjectDialog open={newProjectDialogOpen} onOpenChange={setNewProjectDialogOpen} />
    </>
  )
}
