import { isTauri, openProjectFile, saveProjectFile } from '@/engine/persistence/platformFile'
import { serializeProject } from '@/engine/persistence/serialize'
import { showToast } from '@/components/ui/toastBus'
import { loadProject } from './loadProject'
import { useAppStore } from './useAppStore'

function currentProjectFile() {
  const {
    model, palette, meta, texture,
    ambientOcclusion, noiseLevel, specularNoiseLevel, aoStrength, glassRoughnessLevel, exposure,
    exportScaleFactor, exportAnchor, exportAlignToObjectBounds, exportDisableMeshOptimization,
    animSettings, sliceMasks, slicePivots,
  } = useAppStore.getState()
  return serializeProject(
    model, palette, meta, texture,
    { ambientOcclusion, noiseLevel, specularNoiseLevel, aoStrength, glassRoughnessLevel, exposure, exportScaleFactor, exportAnchor, exportAlignToObjectBounds, exportDisableMeshOptimization },
    animSettings, sliceMasks, slicePivots,
  )
}

async function writeAndReport(path: string | null): Promise<void> {
  const { setCurrentFilePath, markSaved } = useAppStore.getState()
  const result = await saveProjectFile(currentProjectFile(), { path, suggestedName: useAppStore.getState().meta.name })
  if (result.path) {
    setCurrentFilePath(result.path)
    markSaved(new Date().toISOString())
    showToast('Project saved.')
  } else if (!isTauri()) {
    // Web build: a blob download always "succeeds" (there's no dialog to cancel).
    markSaved(new Date().toISOString())
    showToast('Project exported.')
  }
  // Desktop with no path: the user cancelled the native save dialog — no-op.
}

/** Writes to `currentFilePath` with no dialog if one is already set (desktop); otherwise behaves
 * like {@link saveProjectAs}. On the web build this is always a download. */
export async function saveProject(): Promise<void> {
  await writeAndReport(useAppStore.getState().currentFilePath)
}

/** Always shows a save dialog (desktop) or triggers a download (web), regardless of whether a
 * file is already open, and updates `currentFilePath` to the newly chosen path. */
export async function saveProjectAs(): Promise<void> {
  await writeAndReport(null)
}

/** Opens a `.voxpaint`/JSON project via native dialog (desktop) or file picker (web) and loads it
 * into the store. No-op if the user cancels. */
export async function openProject(): Promise<void> {
  try {
    const result = await openProjectFile()
    if (!result) return
    loadProject(result.file, result.path)
    showToast('Project opened.')
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Open failed.')
  }
}
