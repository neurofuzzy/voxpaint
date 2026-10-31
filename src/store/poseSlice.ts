import type { StateCreator } from 'zustand'
import { CLIP_FRAME_SECONDS, newClipId, newKeyId, newPoseId, sanitizeRigName, snapClipTime } from '@/engine/rigging/types'
import type { ClipKey, RigClip } from '@/engine/rigging/types'
import { previewFrame } from '@/engine/rigging/preview'
import type { JointEuler } from '@/engine/rigging/pose'
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

function uniqueClipName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

/** Keeps a clip's duration on the export frame grid and — when looping — at least one
 * frame past the last key, so the wrap segment back to the first key never collapses
 * to zero (the pop the sanitizer guards against on load). Call after any change to a
 * clip's keys, loop flag, or duration. */
function enforceDurationFloor(clip: RigClip): void {
  let duration = snapClipTime(clip.duration)
  if (!Number.isFinite(duration)) duration = CLIP_FRAME_SECONDS
  if (clip.keys.length > 0) {
    const last = clip.keys[clip.keys.length - 1].time
    duration = Math.max(duration, last)
    if (clip.loop) duration = Math.max(duration, snapClipTime(last + CLIP_FRAME_SECONDS))
  }
  clip.duration = Math.max(duration, CLIP_FRAME_SECONDS)
}

/** Sorts a clip's keys by time with the first locked at 0, then re-floors the duration. */
function normalizeKeys(clip: RigClip): void {
  clip.keys.sort((a, b) => a.time - b.time)
  if (clip.keys.length > 0) clip.keys[0].time = 0
  enforceDurationFloor(clip)
}

/**
 * Ephemeral pose preview for Animate mode (Phase 1): per-joint local rotations, radians,
 * intrinsic XYZ. Deliberately outside undo history (preview is not an edit) and outside
 * persistence (cleared on project load by construction — `newProject` rebuilds state — and on
 * leaving Animate mode). Named pose snapshots are the undoable/persisted counterpart: the
 * gizmo writes scratch, Capture freezes it into a pose object. Keyed clips sequence those
 * snapshots on a timeline (one exported action each).
 */
export const createPoseSlice: Slice = (set, get) => ({
  poseRotations: new Map<string, JointEuler>(),
  poses: [],
  clips: [],
  activeClipId: null,
  selectedKeyId: null,
  stagedPoseId: null,
  clipPlaying: false,
  clipStartedAt: 0,
  clipTime: null,
  poseDragging: false,

  setJointRotation: (id, euler) => {
    const box = get().rigBoxes.find((b) => b.id === id)
    if (!box) return
    // Gating is by project animation mode, not per joint: in a tweens project the gizmo
    // never renders and drags never start (see PoseGizmo / Viewport3D), so by the time a
    // rotation lands here the frame is pose-owned.
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
      state.poses.push({ id: pose.id, name: pose.name, joints: { ...pose.joints } })
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
      // A key pointing at a deleted pose would read as bind — drop the keys instead so
      // the timelines only ever reference surviving poses.
      for (const clip of state.clips) {
        const before = clip.keys.length
        clip.keys = clip.keys.filter((k) => k.poseId !== id)
        if (clip.keys.length !== before) normalizeKeys(clip)
        if (state.selectedKeyId && !clip.keys.some((k) => k.id === state.selectedKeyId)) {
          state.selectedKeyId = null
        }
      }
      state.dirty = true
    })
    get().animCommitStroke()
  },

  addClip: () => {
    let id = ''
    get().animBeginStroke()
    set((state) => {
      id = newClipId()
      const name = uniqueClipName('Clip', new Set(state.clips.map((c) => c.name)))
      state.clips.push({ id, name, loop: true, duration: 1, keys: [] })
      state.activeClipId = id
      state.selectedKeyId = null
      state.clipPlaying = false
      state.dirty = true
    })
    get().animCommitStroke()
    return id
  },

  renameClip: (id, name) => {
    get().animBeginStroke()
    set((state) => {
      const clip = state.clips.find((c) => c.id === id)
      if (!clip) return
      const clean = sanitizeRigName(name, 'clip')
      const others = new Set(state.clips.filter((c) => c.id !== id).map((c) => c.name))
      clip.name = uniqueClipName(clean, others)
      state.dirty = true
    })
    get().animCommitStroke()
  },

  deleteClip: (id) => {
    get().animBeginStroke()
    set((state) => {
      state.clips = state.clips.filter((c) => c.id !== id)
      if (state.activeClipId === id) {
        state.activeClipId = state.clips.length > 0 ? state.clips[0].id : null
        state.selectedKeyId = null
        state.clipPlaying = false
      } else if (state.selectedKeyId && !state.clips.some((c) => c.keys.some((k) => k.id === state.selectedKeyId))) {
        state.selectedKeyId = null
      }
      state.dirty = true
    })
    get().animCommitStroke()
  },

  patchClip: (id, patch) => {
    get().animBeginStroke()
    set((state) => {
      const clip = state.clips.find((c) => c.id === id)
      if (!clip) return
      if (patch.loop !== undefined) clip.loop = patch.loop
      if (patch.duration !== undefined) clip.duration = patch.duration
      enforceDurationFloor(clip)
      state.dirty = true
    })
    get().animCommitStroke()
  },

  setActiveClip: (id) => {
    set((state) => {
      if (id !== null && !state.clips.some((c) => c.id === id)) return
      state.activeClipId = id
      state.selectedKeyId = null
      state.clipPlaying = false
      state.clipTime = null
    })
  },

  setSelectedKey: (id) => {
    set((state) => {
      if (id !== null && !state.clips.some((c) => c.keys.some((k) => k.id === id))) return
      state.selectedKeyId = id
    })
  },

  setClipPlaying: (playing) => {
    set((state) => {
      const clip = state.clips.find((c) => c.id === state.activeClipId) ?? null
      if (playing && !clip) return
      const now = performance.now() / 1000
      if (playing) {
        // Resume from the paused playhead rather than restarting at 0. Off the timeline
        // (null), play starts at the top.
        state.clipStartedAt = now - (state.clipTime ?? 0)
        state.clipPlaying = true
      } else if (state.clipPlaying) {
        // Freeze the playhead where it stopped so the paused frame keeps showing.
        state.clipTime = snapClipTime(now - state.clipStartedAt)
        state.clipPlaying = false
      }
    })
  },

  setClipTime: (time) => {
    set((state) => {
      state.clipTime = Math.max(0, snapClipTime(time))
    })
  },

  addKey: (clipId, poseId, time) => {
    const st = get()
    const clip = st.clips.find((c) => c.id === clipId)
    if (!clip) return null
    const resolvedPoseId = poseId ?? st.stagedPoseId ?? st.poses[0]?.id
    if (!resolvedPoseId || !st.poses.some((p) => p.id === resolvedPoseId)) {
      showToast('Stage or capture a pose first — keys point at library poses')
      return null
    }
    let keyId: string | null = null
    get().animBeginStroke()
    set((state) => {
      const target = state.clips.find((c) => c.id === clipId)
      if (!target) return
      keyId = newKeyId()
      target.keys.push({
        id: keyId,
        poseId: resolvedPoseId,
        time: Math.max(0, snapClipTime(time ?? state.clipTime ?? 0)),
        ease: 'inOut' as ClipKey['ease'],
      })
      normalizeKeys(target)
      state.selectedKeyId = keyId
      state.dirty = true
    })
    get().animCommitStroke()
    return keyId
  },

  patchKey: (clipId, keyId, patch) => {
    get().animBeginStroke()
    set((state) => {
      const clip = state.clips.find((c) => c.id === clipId)
      const key = clip?.keys.find((k) => k.id === keyId)
      if (!clip || !key) return
      if (patch.poseId !== undefined) {
        if (!state.poses.some((p) => p.id === patch.poseId)) return
        key.poseId = patch.poseId
      }
      if (patch.time !== undefined) key.time = Math.max(0, snapClipTime(patch.time))
      if (patch.ease !== undefined) key.ease = patch.ease
      normalizeKeys(clip)
      state.dirty = true
    })
    get().animCommitStroke()
  },

  removeKey: (clipId, keyId) => {
    get().animBeginStroke()
    set((state) => {
      const clip = state.clips.find((c) => c.id === clipId)
      if (!clip) return
      clip.keys = clip.keys.filter((k) => k.id !== keyId)
      if (state.selectedKeyId === keyId) state.selectedKeyId = null
      normalizeKeys(clip)
      state.dirty = true
    })
    get().animCommitStroke()
  },

  overwritePose: (id) => {
    const scratch = get().poseRotations
    if (scratch.size === 0) {
      showToast('Pose something first — the scratch is at bind')
      return
    }
    get().animBeginStroke()
    set((state) => {
      const pose = state.poses.find((p) => p.id === id)
      if (!pose) return
      const joints: Record<string, JointEuler> = {}
      for (const [jointId, euler] of state.poseRotations) {
        if (!isBind(euler)) joints[jointId] = [...euler] as JointEuler
      }
      pose.joints = joints
      state.poseRotations.clear()
      // Stage what was just saved so the preview keeps showing it instead of dropping
      // to bind — and step off the timeline so the staged pose actually shows.
      state.stagedPoseId = id
      state.clipTime = null
      state.dirty = true
    })
    get().animCommitStroke()
  },

  grabPoseForEdit: () => {
    const st = get()
    // Snapshot first: the preview may BE the live scratch map, which we clear below.
    const entries = [...previewFrame(st, performance.now() / 1000).pose.entries()]
    if (entries.length === 0 && !st.clipPlaying) {
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
      state.clipPlaying = false
      // Off the timeline: the preview now follows the scratch the grab just filled, so
      // gizmo drags keep showing on screen instead of fighting a frozen clip frame.
      state.clipTime = null
    })
  },

  stagePose: (id) => {
    set((state) => {
      state.stagedPoseId = id && state.poses.some((p) => p.id === id) ? id : null
      // Staging steps off the timeline so the staged pose (or scratch) actually shows.
      state.clipTime = null
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
      state.clipTime = null
    })
  },

  resetPose: () => {
    set((state) => {
      state.poseRotations.clear()
      state.stagedPoseId = null
      state.clipPlaying = false
      state.clipTime = null
    })
  },

  setPoseDragging: (dragging) => {
    set((state) => {
      state.poseDragging = dragging
    })
  },
})
