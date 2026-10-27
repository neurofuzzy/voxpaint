import type { StateCreator } from 'zustand'
import type { JointEuler } from '@/engine/rigging/pose'
import type { AppState, PoseSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PoseSlice>

/** Near-zero rotations collapse back to bind so the map only holds joints that visibly move. */
const EPSILON = 1e-9

/**
 * Ephemeral pose preview for Animate mode (Phase 1): per-joint local rotations, radians,
 * intrinsic XYZ. Deliberately outside undo history (preview is not an edit) and outside
 * persistence (cleared on project load by construction — `newProject` rebuilds state — and on
 * leaving Animate mode). Keyframes (Phase 2) will snapshot this representation.
 */
export const createPoseSlice: Slice = (set) => ({
  poseRotations: new Map<string, JointEuler>(),
  poseDragging: false,

  setJointRotation: (id, euler) => {
    set((state) => {
      if (!state.rigBoxes.some((b) => b.id === id)) return
      if (Math.abs(euler[0]) < EPSILON && Math.abs(euler[1]) < EPSILON && Math.abs(euler[2]) < EPSILON) {
        state.poseRotations.delete(id)
        return
      }
      state.poseRotations.set(id, [...euler] as JointEuler)
    })
  },

  resetPose: () => {
    set((state) => {
      state.poseRotations.clear()
    })
  },

  setPoseDragging: (dragging) => {
    set((state) => {
      state.poseDragging = dragging
    })
  },
})
