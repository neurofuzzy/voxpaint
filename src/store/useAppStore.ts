import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createAnimationSlice } from './animationSlice'
import { createHistorySlice } from './historySlice'
import { createMarkerSlice } from './markerSlice'
import { createModeSlice } from './modeSlice'
import { createRiggingSlice } from './riggingSlice'
import { createPaintActionsSlice } from './paintActions'
import { createPersistenceSlice } from './persistenceSlice'
import { createPlaneSlice } from './planeSlice'
import { createPoseSlice } from './poseSlice'
import { createProjectSlice } from './projectSlice'
import { createSelectionSlice } from './selectionSlice'
import { createSelection3DSlice } from './selection3DSlice'
import { createMoveActionsSlice } from './moveActions'
import { createTextureSlice } from './textureSlice'
import { createToolActionsSlice } from './toolActionsSlice'
import { createToolSlice } from './toolSlice'
import type { AppState } from './types'
import { createUiSlice } from './uiSlice'
import { createViewSlice } from './viewSlice'

enableMapSet()

export const useAppStore = create<AppState>()(
  immer((...a) => ({
    ...createProjectSlice(...a),
    ...createHistorySlice(...a),
    ...createPlaneSlice(...a),
    ...createToolSlice(...a),
    ...createSelectionSlice(...a),
    ...createSelection3DSlice(...a),
    ...createViewSlice(...a),
    ...createPersistenceSlice(...a),
    ...createPaintActionsSlice(...a),
    ...createToolActionsSlice(...a),
    ...createMoveActionsSlice(...a),
    ...createModeSlice(...a),
    ...createTextureSlice(...a),
    ...createAnimationSlice(...a),
    ...createMarkerSlice(...a),
    ...createRiggingSlice(...a),
    ...createPoseSlice(...a),
    ...createUiSlice(...a),
  })),
)
