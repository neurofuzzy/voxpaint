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
    // mask tools (which also call bakeFloatIfAny before their own stroke, per editToolFactory)
    // never silently commit a model change that Animate's undo can't see.
    if (mode === 'animate') {
      get().bakeFloatIfAny()
    }
    set((state) => {
      state.mode = mode
      // Animate mode only has mask paint/erase handlers (see engine/tools's animateToolMap) — land
      // on a tool that's actually wired up there instead of leaving dispatch pointed at one that
      // silently no-ops (e.g. 'select' or 'move' from Model mode).
      if (mode === 'animate' && state.activeTool !== 'paint' && state.activeTool !== 'erase') {
        state.activeTool = 'paint'
      }
    })
  },
})
