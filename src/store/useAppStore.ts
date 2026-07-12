import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createHistorySlice } from './historySlice'
import { createModeSlice } from './modeSlice'
import { createPaintActionsSlice } from './paintActions'
import { createPersistenceSlice } from './persistenceSlice'
import { createPlaneSlice } from './planeSlice'
import { createProjectSlice } from './projectSlice'
import { createSelectionSlice } from './selectionSlice'
import { createMoveActionsSlice } from './moveActions'
import { createTextureSlice } from './textureSlice'
import { createToolActionsSlice } from './toolActionsSlice'
import { createToolSlice } from './toolSlice'
import type { AppState } from './types'
import { createViewSlice } from './viewSlice'

enableMapSet()

export const useAppStore = create<AppState>()(
  immer((...a) => ({
    ...createProjectSlice(...a),
    ...createHistorySlice(...a),
    ...createPlaneSlice(...a),
    ...createToolSlice(...a),
    ...createSelectionSlice(...a),
    ...createViewSlice(...a),
    ...createPersistenceSlice(...a),
    ...createPaintActionsSlice(...a),
    ...createToolActionsSlice(...a),
    ...createMoveActionsSlice(...a),
    ...createModeSlice(...a),
    ...createTextureSlice(...a),
  })),
)
