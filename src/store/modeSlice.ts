import type { StateCreator } from 'zustand'
import type { AppState, ModeSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ModeSlice>

/**
 * The single top-level authoring-mode switch. Everything that differs between voxel modeling and
 * texture painting keys off `mode` — canvas, 3D preview, palette, undo/redo dispatch — so mode
 * awareness stays at component boundaries (whole-subtree gating) instead of being sprinkled through
 * the code.
 */
export const createModeSlice: Slice = (set, get) => ({
  mode: 'model',
  setMode: (mode) => {
    // Animate mode's undo/redo dispatches to the animation history stack (animUndo/animRedo),
    // which cannot revert voxel-model changes. Resolving any pending float here means Animate's
    // rig strokes (which bracket their own undo, like the old mask tools did) never silently
    // commit a model change that Animate's undo can't see.
    if (mode === 'animate') {
      get().bakeFloatIfAny()
    }
    // Pose preview is Animate-only working state — leaving the mode drops it back to bind
    // (it survives tool/selection changes inside Animate, and Reset clears it explicitly).
    if (mode !== 'animate' && get().poseRotations.size > 0) {
      get().resetPose()
    }
    set((state) => {
      state.mode = mode
      // Animate tools follow the panel tab (see animateToolMap + ANIMATE_TOOLS) — land on a
      // tab whose toolbar actually wires the current tool up instead of leaving dispatch
      // pointed at one that silently no-ops. Unknown tools fall back to rig + rigbox.
      if (mode === 'animate') {
        const t = state.activeTool
        if (t === 'pose') {
          state.animateTab = 'poses'
        } else if (t === 'select') {
          state.animateTab = 'tweens'
        } else if (t === 'rigbox' || t === 'pivot') {
          state.animateTab = 'rig'
        } else {
          state.animateTab = 'rig'
          state.activeTool = 'rigbox'
        }
        // The panel only shows one motion tab per project — clamp a hidden tab (and its
        // tool) to the visible one so the toolbar never points at a tab that isn't there.
        const animationMode = state.meta.animationMode ?? 'tweens'
        if (animationMode === 'tweens' && state.animateTab === 'poses') {
          state.animateTab = 'tweens'
          state.activeTool = 'select'
        } else if (animationMode === 'poses' && state.animateTab === 'tweens') {
          state.animateTab = 'poses'
          state.activeTool = 'pose'
        }
      }
    })
    // Animate and Texture modes have no 3D-only editing surface — leaving Model mode drops the
    // live layout to split (without touching Model's remembered layout), and coming back to
    // Model restores what it was.
    if (mode !== 'model') {
      if (get().layoutMode !== 'split') get().setLayoutMode('split')
    } else if (get().layoutMode !== get().modelLayout) {
      get().setLayoutMode(get().modelLayout)
    }
  },
})
