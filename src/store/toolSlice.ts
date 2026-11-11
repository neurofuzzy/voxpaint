import type { StateCreator } from 'zustand'
import { GRID_FULL_SPLIT, GRID_HALF_SPLITS, GRID_QUARTER_SPLITS, advanceGridSplit } from '@/engine/grid/subdiv'
import { showToast } from '@/components/ui/toastBus'
import type { AppState, ToolSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ToolSlice>

export const createToolSlice: Slice = (set, get) => ({
  activeTool: 'paint',
  animateTab: 'rig',
  activeVoxelKind: 'cube',
  activePaletteSlot: { kind: 'base', index: 0 },
  brushRotation: 0,
  gridFamily: 'whole',
  pendingSplit: null,
  paintLineAnchor: null,

  setAnimateTab: (tab) => {
    if (get().animateTab === tab) return
    set((state) => {
      // The panel only shows one motion tab per project (Rig + Tweens for machines,
      // Rig + Poses for characters) — a hidden tab maps to the visible one.
      const mode = state.meta.animationMode ?? 'tweens'
      const resolved = tab === 'tweens' && mode === 'poses' ? 'poses' : tab === 'poses' && mode === 'tweens' ? 'tweens' : tab
      state.animateTab = resolved
      // Each tab owns its tools — arm the primary one so taps always dispatch to a
      // handler that makes sense for what's on screen (the stale-tool toast trap).
      state.activeTool = resolved === 'rig' ? 'rigbox' : resolved === 'tweens' ? 'select' : 'pose'
    })
  },

  setActiveTool: (tool) => {
    set((state) => { state.activeTool = tool })
    // Posing an invisible model is meaningless — Hidden blanks exactly the voxels that
    // move (boxes, pivots, and the gizmo stay frozen), so entering Pose mode lifts the
    // view to Ghost, which exists precisely to read rigs through the model.
    if ((tool === 'pose' || tool === 'offset') && get().mode === 'animate' && get().animateModelView === 'hidden') {
      get().setAnimateModelView('ghost')
      showToast('Model view switched to Ghost — posing needs the model visible')
    }
  },
  setPendingSplit: (split) => {
    set((state) => { state.pendingSplit = split })
    get().snapPlaneToGrid()
  },
  setGridDivision: (family) => {
    const cur = get().gridFamily
    if (family === 'whole') {
      set((state) => {
        state.gridFamily = 'whole'
        state.pendingSplit = null
      })
      get().snapPlaneToGrid()
      return
    }
    if (family === cur) {
      // Re-click cycles the family's divisions globally (X → Y → Z; leave-orders wrap).
      const next = advanceGridSplit(family, get().pendingSplit)
      set((state) => {
        state.pendingSplit = next
      })
      get().snapPlaneToGrid()
      return
    }
    const first =
      family === 'half' ? [...GRID_HALF_SPLITS[0]] : family === 'quarter' ? [...GRID_QUARTER_SPLITS[0]] : [...GRID_FULL_SPLIT]
    set((state) => {
      state.gridFamily = family
      state.pendingSplit = first
    })
    get().snapPlaneToGrid()
  },
  setActiveVoxelKind: (kind) => set((state) => { state.activeVoxelKind = kind }),
  setActivePaletteSlot: (slot) => set((state) => { state.activePaletteSlot = slot }),
  setBrushRotation: (r) => set((state) => { state.brushRotation = r }),
  rotateBrush: (dir) => set((state) => { state.brushRotation = ((state.brushRotation + dir + 4) % 4) as typeof state.brushRotation }),
  setPaintLineAnchor: (anchor) => set((state) => { state.paintLineAnchor = anchor }),
  clearPaintLineAnchor: () => set((state) => { state.paintLineAnchor = null }),
})
