import { debounce, loadAutosave, saveAutosave } from '@/engine/persistence/autosave'
import { serializeProject } from '@/engine/persistence/serialize'
import { loadProject } from './loadProject'
import { useAppStore } from './useAppStore'

const AUTOSAVE_DEBOUNCE_MS = 800

/** Restores the last autosaved project on load, if any. Call once at app startup. */
export function restoreAutosave(): void {
  try {
    const file = loadAutosave()
    if (!file) return
    loadProject(file)
  } catch (err) {
    console.error('Failed to restore autosave', err)
  }
}

const flush = debounce(() => {
  const state = useAppStore.getState()
  try {
    const file = serializeProject(
      state.model,
      state.palette,
      state.meta,
      state.texture,
      { ambientOcclusion: state.ambientOcclusion, noiseLevel: state.noiseLevel, specularNoiseLevel: state.specularNoiseLevel, aoStrength: state.aoStrength, glassRoughnessLevel: state.glassRoughnessLevel, exposure: state.exposure, exportScaleFactor: state.exportScaleFactor, exportAnchor: state.exportAnchor, exportAlignToObjectBounds: state.exportAlignToObjectBounds, exportDisableMeshOptimization: state.exportDisableMeshOptimization },
      state.animSettings,
      state.sliceMasks,
      state.slicePivots,
    )
    saveAutosave(file)
    state.markSaved(new Date().toISOString())
  } catch (err) {
    state.setError(err instanceof Error ? err.message : 'Autosave failed')
  }
}, AUTOSAVE_DEBOUNCE_MS)

/** Subscribes to dirty-flagging store changes and debounces writes to localStorage. Call once at app startup. */
export function wireAutosave(): () => void {
  return useAppStore.subscribe((state, prevState) => {
    if (state.dirty && state.dirty !== prevState.dirty) flush()
    else if (state.model !== prevState.model && state.dirty) flush()
    else if (state.texture !== prevState.texture && state.dirty) flush()
    else if (state.animSettings !== prevState.animSettings && state.dirty) flush()
    else if (state.sliceMasks !== prevState.sliceMasks && state.dirty) flush()
    else if (state.slicePivots !== prevState.slicePivots && state.dirty) flush()
  })
}
