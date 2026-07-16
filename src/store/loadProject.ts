import { deserializeProject } from '@/engine/persistence/serialize'
import type { VoxPaintProjectFile } from '@/engine/persistence/schema'
import { useAppStore } from './useAppStore'

/**
 * Loads a parsed project file into the store: model/palette/texture, every view setting (falling
 * back to defaults for optional fields absent on older schema versions), and animation state —
 * then clears animation undo/redo history so it can't point at slices from a different project.
 * `filePath` records the on-disk path this session is now backed by (desktop only; always null on
 * the web build and for autosave restores). Shared by autosave restore, JSON/`.voxpaint` import,
 * and the desktop app's native-open/double-click paths so they can never diverge — see
 * `wireAutosave.ts`, `FileMenu.tsx`, `App.tsx`.
 */
export function loadProject(parsed: VoxPaintProjectFile, filePath: string | null = null): void {
  const { model, palette, meta, texture, view, animSettings, sliceMasks, slicePivots } = deserializeProject(parsed)
  useAppStore.getState().setModel(model)
  useAppStore.getState().setPalette(palette)
  useAppStore.getState().setTexture(texture)
  useAppStore.setState((state) => {
    state.meta = meta
    state.ambientOcclusion = view.ambientOcclusion ?? false
    state.noiseLevel = view.noiseLevel ?? 0
    state.specularNoiseLevel = view.specularNoiseLevel ?? 0
    state.aoStrength = view.aoStrength ?? 1
    state.glassRoughnessLevel = view.glassRoughnessLevel ?? 0.3
    state.exposure = view.exposure ?? 1
    state.exportScaleFactor = view.exportScaleFactor ?? 100
    state.exportAnchor = view.exportAnchor ?? 'center'
    state.exportAlignToObjectBounds = view.exportAlignToObjectBounds ?? false
    state.exportDisableMeshOptimization = view.exportDisableMeshOptimization ?? false
    state.animSettings = animSettings
    state.sliceMasks = sliceMasks
    state.slicePivots = slicePivots
    state.animPast = []
    state.animFuture = []
    state.currentFilePath = filePath
    state.dirty = false
  })
}
