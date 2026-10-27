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
    set((state) => {
      state.mode = mode
      // Animate mode only has rig/pivot handlers wired up (see engine/tools's animateToolMap) —
      // land on a tool that's actually wired up there instead of leaving dispatch pointed at
      // one that silently no-ops (e.g. 'select' or 'move' from Model mode).
      if (mode === 'animate' && state.activeTool !== 'pivot' && state.activeTool !== 'rigbox') {
        state.activeTool = 'rigbox'
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
