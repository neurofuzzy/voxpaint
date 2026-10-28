import type { StateCreator } from 'zustand'
import { newPoseId } from '@/engine/rigging/types'
import type { PoseCycle } from '@/engine/rigging/types'
import { chainHasActiveTweens } from '@/engine/rigging/rigLoop'
import type { JointEuler } from '@/engine/rigging/pose'
import { resolvePreviewPose } from '@/engine/rigging/pose'
import { showToast } from '@/components/ui/toastBus'
import type { AppState, PoseSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PoseSlice>

/** Near-zero rotations collapse back to bind so the map only holds joints that visibly move. */
const EPSILON = 1e-9

function isBind(euler: JointEuler): boolean {
  return Math.abs(euler[0]) < EPSILON && Math.abs(euler[1]) < EPSILON && Math.abs(euler[2]) < EPSILON
}

function uniquePoseName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

function nextDefaultName(poses: { name: string }[]): string {
  return uniquePoseName('Pose', new Set(poses.map((p) => p.name)))
}

/**
 * Ephemeral pose preview for Animate mode (Phase 1): per-joint local rotations, radians,
 * intrinsic XYZ. Deliberately outside undo history (preview is not an edit) and outside
 * persistence (cleared on project load by construction — `newProject` rebuilds state — and on
 * leaving Animate mode). Named pose snapshots (Phase 2, below) are the undoable/persisted
 * counterpart: the gizmo writes scratch, Capture freezes it into a pose object.
 */
export const createPoseSlice: Slice = (set, get) => ({
  poseRotations: new Map<string, JointEuler>(),
  poses: [],
  stagedPoseId: null,
  poseCycle: null,
  cyclePlaying: false,
  cycleStartedAt: 0,
  poseDragging: false,

  setJointRotation: (id, euler) => {
    const box = get().rigBoxes.find((b) => b.id === id)
    if (!box) return
    // Mutually exclusive with tweening: posing samples the static parent chain, so a
    // tween anywhere up the chain refuses (the press-time guards normally get here first —
    // this is the backstop for in-flight drags).
    if (chainHasActiveTweens(get().rigBoxes, box)) {
      showToast('That joint rides an active tween — mute tweens in the panel to pose')
      return
    }
    set((state) => {
      if (!state.rigBoxes.some((b) => b.id === id)) return
      if (isBind(euler)) {
        state.poseRotations.delete(id)
        return
      }
      state.poseRotations.set(id, [...euler] as JointEuler)
    })
  },

  capturePose: () => {
    const scratch = get().poseRotations
    if (scratch.size === 0) {
      showToast('Pose something first — the scratch is at bind')
      return null
    }
    const joints: Record<string, JointEuler> = {}
    for (const [id, euler] of scratch) {
      if (!isBind(euler)) joints[id] = [...euler] as JointEuler
    }
    if (Object.keys(joints).length === 0) return null
    const pose = { id: newPoseId(), name: '', joints }
    get().animBeginStroke()
    set((state) => {
      pose.name = nextDefaultName(state.poses)
      state.poses.push({ ...pose, joints: { ...pose.joints } })
      state.stagedPoseId = pose.id
      state.poseRotations.clear()
      state.dirty = true
    })
    get().animCommitStroke()
    return pose.id
  },

  renamePose: (id, name) => {
    const clean = name.trim().slice(0, 64)
    if (!clean) return
    get().animBeginStroke()
    set((state) => {
      const pose = state.poses.find((p) => p.id === id)
      if (!pose) return
      pose.name = clean
      state.dirty = true
    })
    get().animCommitStroke()
  },

  deletePose: (id) => {
    get().animBeginStroke()
    set((state) => {
      state.poses = state.poses.filter((p) => p.id !== id)
      if (state.stagedPoseId === id) state.stagedPoseId = null
      // A cycle pointing at a deleted pose can't play — clear it rather than silently
      // rebinding to bind.
      if (state.poseCycle && (state.poseCycle.fromId === id || state.poseCycle.toId === id)) {
        state.poseCycle = null
        state.cyclePlaying = false
      }
      state.dirty = true
    })
    get().animCommitStroke()
  },

  setPoseCycle: (cycle: PoseCycle | null) => {
    get().animBeginStroke()
    set((state) => {
      state.poseCycle = cycle ? { ...cycle } : null
      state.cyclePlaying = false
      state.dirty = true
    })
    get().animCommitStroke()
  },

  setCyclePlaying: (playing) => {
    set((state) => {
      if (playing && !state.poseCycle) return
      state.cyclePlaying = playing
      if (playing) state.cycleStartedAt = performance.now() / 1000
    })
  },

  grabPoseForEdit: () => {
    const st = get()
    const cycleTime = st.cyclePlaying && st.poseCycle ? performance.now() / 1000 - st.cycleStartedAt : null
    // Snapshot first: the preview may BE the live scratch map, which we clear below.
    const entries = [...resolvePreviewPose(st.poses, st.stagedPoseId, st.poseRotations, st.poseCycle, cycleTime).entries()]
    if (entries.length === 0 && !st.cyclePlaying) {
      // Nothing to grab beyond the scratch itself — just unstage.
      if (st.stagedPoseId) {
        set((state) => {
          state.stagedPoseId = null
        })
      }
      return
    }
    set((state) => {
      state.poseRotations.clear()
      for (const [id, euler] of entries) {
        if (state.rigBoxes.some((b) => b.id === id)) {
          state.poseRotations.set(id, [...euler] as JointEuler)
        }
      }
      state.stagedPoseId = null
      state.cyclePlaying = false
    })
  },

  stagePose: (id) => {
    set((state) => {
      state.stagedPoseId = id && state.poses.some((p) => p.id === id) ? id : null
    })
  },

  adoptStagedPose: () => {
    const staged = get().poses.find((p) => p.id === get().stagedPoseId)
    if (!staged) return
    set((state) => {
      state.poseRotations.clear()
      for (const [id, euler] of Object.entries(staged.joints)) {
        if (state.rigBoxes.some((b) => b.id === id)) {
          state.poseRotations.set(id, [...euler] as JointEuler)
        }
      }
      state.stagedPoseId = null
    })
  },

  resetPose: () => {
    set((state) => {
      state.poseRotations.clear()
      state.stagedPoseId = null
      state.cyclePlaying = false
    })
  },

  setPoseDragging: (dragging) => {
    set((state) => {
      state.poseDragging = dragging
    })
  },
})
