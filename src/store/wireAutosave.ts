import { debounce, loadAutosave, saveAutosave } from '@/engine/persistence/autosave'
import { deserializeProject, serializeProject } from '@/engine/persistence/serialize'
import { useAppStore } from './useAppStore'

const AUTOSAVE_DEBOUNCE_MS = 800

/** Restores the last autosaved project on load, if any. Call once at app startup. */
export function restoreAutosave(): void {
  try {
    const file = loadAutosave()
    if (!file) return
    const { model, palette, meta } = deserializeProject(file)
    useAppStore.getState().setModel(model)
    useAppStore.getState().setPalette(palette)
    useAppStore.setState((state) => {
      state.meta = meta
    })
  } catch (err) {
    console.error('Failed to restore autosave', err)
  }
}

const flush = debounce(() => {
  const state = useAppStore.getState()
  try {
    const file = serializeProject(state.model, state.palette, state.meta)
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
  })
}
