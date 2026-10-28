import { debounce, loadAutosave, saveAutosave } from '@/engine/persistence/autosave'
import { deserializeProject, serializeProject } from '@/engine/persistence/serialize'
import { clampPlaneOffset } from '@/engine/grid/GridStore'
import { loadUiPrefs } from '@/engine/persistence/uiPrefs'
import { useAppStore } from './useAppStore'

const AUTOSAVE_DEBOUNCE_MS = 800

/** Restores the last autosaved project on load, if any. Call once at app startup. */
export function restoreAutosave(): void {
  try {
    const file = loadAutosave()
    if (!file) return
    const { model, palette, meta, texture, view, animSettings, sliceMasks, slicePivots, markers, rigBoxes, poses, poseCycle } = deserializeProject(file)
    useAppStore.getState().setModel(model)
    useAppStore.getState().setPalette(palette)
    useAppStore.getState().setTexture(texture)
    useAppStore.setState((state) => {
      state.meta = meta
      state.ambientOcclusion = view.ambientOcclusion ?? false
      state.noiseLevel = view.noiseLevel ?? 0
      state.specularNoiseLevel = view.specularNoiseLevel ?? 0
      state.noiseScale = view.noiseScale === 2 || view.noiseScale === 4 ? view.noiseScale : 1
      state.aoStrength = view.aoStrength ?? 1
      state.glassRoughnessLevel = view.glassRoughnessLevel ?? 0.3
      state.exposure = view.exposure ?? 1
      state.exportScaleFactor = view.exportScaleFactor ?? 100
      state.exportAnchor = view.exportAnchor ?? 'center'
      state.exportAlignToObjectBounds = view.exportAlignToObjectBounds ?? false
      state.exportDisableMeshOptimization = view.exportDisableMeshOptimization ?? false
      state.exportCullInteriorFaces = view.exportCullInteriorFaces ?? true
      state.animSettings = animSettings
      state.sliceMasks = sliceMasks
      state.slicePivots = slicePivots
      state.markers = markers
      state.rigBoxes = rigBoxes
      state.selectedRigBoxId = null
      state.selectedMarkerId = null
      // Poses persist; staging and transport are session-only and start cleared.
      state.poses = poses
      state.poseCycle = poseCycle
      state.stagedPoseId = null
      state.cyclePlaying = false
    })
    // A refresh restores the same project, so the persisted plane pose comes back with it
    // (clamped — a hand-edited autosave could carry an out-of-range offset). Explicit project
    // switches reset instead (see resetPlaneToGround).
    const savedPlane = loadUiPrefs().plane
    if (savedPlane) {
      useAppStore.setState((state) => {
        state.plane.axis = savedPlane.axis
        state.plane.orientation = savedPlane.orientation
        state.plane.offset = clampPlaneOffset(savedPlane.offset, state.meta.gridExtent)
        state.objectModeTarget = null
      })
    }
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
      { ambientOcclusion: state.ambientOcclusion, noiseLevel: state.noiseLevel, specularNoiseLevel: state.specularNoiseLevel, noiseScale: state.noiseScale, aoStrength: state.aoStrength, glassRoughnessLevel: state.glassRoughnessLevel, exposure: state.exposure, exportScaleFactor: state.exportScaleFactor, exportAnchor: state.exportAnchor, exportAlignToObjectBounds: state.exportAlignToObjectBounds, exportDisableMeshOptimization: state.exportDisableMeshOptimization, exportCullInteriorFaces: state.exportCullInteriorFaces, exportIncludeTextureMaps: state.exportIncludeTextureMaps, exportIncludeAOMaps: state.exportIncludeAOMaps, exportIncludeMarkers: state.exportIncludeMarkers, exportIncludeAnimations: state.exportIncludeAnimations },
      state.animSettings,
      state.sliceMasks,
      state.slicePivots,
      state.markers,
      state.rigBoxes,
      state.poses,
      state.poseCycle,
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
    else if (state.markers !== prevState.markers && state.dirty) flush()
    else if (state.texture !== prevState.texture && state.dirty) flush()
    else if (state.animSettings !== prevState.animSettings && state.dirty) flush()
    else if (state.sliceMasks !== prevState.sliceMasks && state.dirty) flush()
    else if (state.slicePivots !== prevState.slicePivots && state.dirty) flush()
    else if (state.rigBoxes !== prevState.rigBoxes && state.dirty) flush()
  })
}
