import type { StateCreator } from 'zustand'
import { showToast } from '@/components/ui/toastBus'
import type { AppState, ToolSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ToolSlice>

export const createToolSlice: Slice = (set, get) => ({
  activeTool: 'paint',
  activeVoxelKind: 'cube',
  activePaletteSlot: { kind: 'base', index: 0 },
  brushRotation: 0,
  paintLineAnchor: null,

  setActiveTool: (tool) => {
    set((state) => { state.activeTool = tool })
    // Posing an invisible model is meaningless — Hidden blanks exactly the voxels that
    // move (boxes, pivots, and the gizmo stay frozen), so entering Pose mode lifts the
    // view to Ghost, which exists precisely to read rigs through the model.
    if (tool === 'pose' && get().mode === 'animate' && get().animateModelView === 'hidden') {
      get().setAnimateModelView('ghost')
      showToast('Model view switched to Ghost — posing needs the model visible')
    }
  },
  setActiveVoxelKind: (kind) => set((state) => { state.activeVoxelKind = kind }),
  setActivePaletteSlot: (slot) => set((state) => { state.activePaletteSlot = slot }),
  setBrushRotation: (r) => set((state) => { state.brushRotation = r }),
  rotateBrush: (dir) => set((state) => { state.brushRotation = ((state.brushRotation + dir + 4) % 4) as typeof state.brushRotation }),
  setPaintLineAnchor: (anchor) => set((state) => { state.paintLineAnchor = anchor }),
  clearPaintLineAnchor: () => set((state) => { state.paintLineAnchor = null }),
})
