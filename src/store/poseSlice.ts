import type { StateCreator } from 'zustand'
import type { Coord } from '@/engine/grid/types'
import { DEFAULT_FPS, newClipId, newKeyId, normalizeFps, sanitizeRigName, snapClipTime } from '@/engine/rigging/types'
import type { ClipKey } from '@/engine/rigging/types'
import { mirrorJoints } from '@/engine/rigging/mirror'
import type { JointEuler } from '@/engine/rigging/pose'
import { showToast } from '@/components/ui/toastBus'
import type { AppState, PoseSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PoseSlice>

/** Near-zero rotations collapse back to bind so the map only holds joints that visibly move. */
const EPSILON = 1e-9

function isBind(euler: JointEuler): boolean {
  return Math.abs(euler[0]) < EPSILON && Math.abs(euler[1]) < EPSILON && Math.abs(euler[2]) < EPSILON
}

function uniqueKeyName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

function uniqueClipName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

/** Project frame rate for grid math (integer 1–120, default 30). */
function fpsOf(state: { meta: { fps?: number } }): number {
  return normalizeFps(state.meta.fps)
}

/** Keeps a clip's duration on the export frame grid — and when looping, at least one
 * frame past the last key, so the wrap segment back to the first key never collapses
 * to zero (the pop the sanitizer guards against on load). Call after any change to a
 * clip's keys, loop flag, or duration. */
function enforceDurationFloor(clip: { keys: { time: number }[]; loop: boolean; duration: number }, fps: number = DEFAULT_FPS): void {
  const frame = 1 / normalizeFps(fps)
  let duration = snapClipTime(clip.duration, fps)
  if (!Number.isFinite(duration)) duration = frame
  if (clip.keys.length > 0) {
    const last = clip.keys[clip.keys.length - 1].time
    duration = Math.max(duration, last)
    if (clip.loop) duration = Math.max(duration, snapClipTime(last + frame, fps))
  }
  clip.duration = Math.max(duration, frame)
}

/** Sorts a clip's keys by time with the first locked at 0, then re-floors the duration. */
function normalizeKeys(clip: { keys: { time: number }[]; loop: boolean; duration: number }, fps: number = DEFAULT_FPS): void {
  clip.keys.sort((a, b) => a.time - b.time)
  if (clip.keys.length > 0) clip.keys[0].time = 0
  enforceDurationFloor(clip, fps)
}

/**
 * Clamps a key time into the strip's fixed scale: no earlier than one frame past the
 * locked first key at 0, no later than the clip end — one frame shy of it when looping,
 * so the wrap segment back to the first key never collapses (the pop the sanitizer
 * guards against on load). Snapped to the export frame grid. Retiming never grows the
 * clip; the duration field owns that. Strip drags pass the duration captured at
 * pointer-down so the scale stays fixed for the whole gesture.
 */
export function clampKeyTime(time: number, duration: number, loop: boolean, fps: number = DEFAULT_FPS): number {
  const frame = 1 / normalizeFps(fps)
  const end = snapClipTime(loop ? duration - frame : duration, fps)
  return Math.min(Math.max(snapClipTime(time, fps), frame), Math.max(end, frame))
}

/**
 * Timeline-first pose state: each keyframe IS its pose (it owns its joint angles
 * directly — no library, no staging). Every edit — gizmo drags, joint card, mirror —
 * lands in the selected keyframe, one undo entry per gesture via the nesting-aware
 * stroke. With no key selected there is nothing to edit, so edit entry points
 * re-seek onto the selection (or toast when there is none) instead of staging.
 */
export const createPoseSlice: Slice = (set, get) => ({
  clips: [],
  activeClipId: null,
  selectedKeyId: null,
  clipPlaying: false,
  clipStartedAt: 0,
  clipTime: null,
  poseDragging: false,

  setKeyJoint: (clipId, keyId, jointId, euler) => {
    if (!get().rigBoxes.some((b) => b.id === jointId)) return
    get().animBeginStroke()
    set((state) => {
      const key = state.clips.find((c) => c.id === clipId)?.keys.find((k) => k.id === keyId)
      if (!key) return
      if (isBind(euler)) {
        delete key.joints[jointId]
        return
      }
      key.joints[jointId] = [...euler] as JointEuler
      state.dirty = true
    })
    get().animCommitStroke()
  },

  setKeyOffset: (clipId, keyId, jointId, offset) => {
    const box = get().rigBoxes.find((b) => b.id === jointId)
    // Offsets are roots-only (a bob on a child would fight its parent's chain) — the
    // gizmo and the card only offer them on roots; anything else is a no-op.
    if (!box || box.parentId !== null) return
    get().animBeginStroke()
    set((state) => {
      const key = state.clips.find((c) => c.id === clipId)?.keys.find((k) => k.id === keyId)
      if (!key) return
      if (Math.abs(offset[0]) < EPSILON && Math.abs(offset[1]) < EPSILON && Math.abs(offset[2]) < EPSILON) {
        if (key.offsets) {
          delete key.offsets[jointId]
          if (Object.keys(key.offsets).length === 0) delete key.offsets
        }
        return
      }
      if (!key.offsets) key.offsets = {}
      key.offsets[jointId] = [...offset] as Coord
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
      // Every clip opens with its frame-1 anchor already in place (bind pose, locked at
      // 0, undeletable) so the timeline is never an empty strip and the first pose has
      // somewhere to land.
      const keyId = newKeyId()
      state.clips.push({ id, name, loop: true, duration: 1, keys: [{ id: keyId, name: 'Key 1', joints: {}, time: 0, ease: 'inOut' as ClipKey['ease'] }] })
      state.activeClipId = id
      state.selectedKeyId = keyId
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
      enforceDurationFloor(clip, fpsOf(state))
      state.dirty = true
    })
    get().animCommitStroke()
  },

  setActiveClip: (id) => {
    set((state) => {
      if (id !== null && !state.clips.some((c) => c.id === id)) return
      state.activeClipId = id
      // The clip always opens with a key under edit (its first), so the joint card and
      // the gizmo never point at nothing; null only when deselected.
      const clip = id !== null ? state.clips.find((c) => c.id === id) : null
      state.selectedKeyId = clip && clip.keys.length > 0 ? clip.keys[0].id : null
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
        state.clipTime = snapClipTime(now - state.clipStartedAt, fpsOf(state))
        state.clipPlaying = false
      }
    })
  },

  setClipTime: (time) => {
    set((state) => {
      state.clipTime = Math.max(0, snapClipTime(time, fpsOf(state)))
    })
  },

  addKeyframe: (clipId, time, init) => {
    let keyId: string | null = null
    get().animBeginStroke()
    set((state) => {
      const target = state.clips.find((c) => c.id === clipId)
      if (!target) return
      keyId = newKeyId()
      // Off the timeline with no explicit time: append half a second past the last key
      // (0 into an empty clip). Keys stay sorted via normalizeKeys below.
      const lastKey = target.keys.length > 0 ? target.keys[target.keys.length - 1].time : -0.5
      const taken = new Set(target.keys.map((k) => k.name))
      const fps = fpsOf(state)
      // Retiming rules apply at birth too: a new key never lands exactly on the
      // anchor (frame 1 double-clicks clamp one frame later) nor past the end —
      // the duration floor below grows the clip instead.
      const raw = Math.max(0, snapClipTime(time ?? state.clipTime ?? lastKey + 0.5, fps))
      target.keys.push({
        id: keyId,
        name: uniqueKeyName(`Key ${target.keys.length + 1}`, taken),
        joints: init?.joints ? { ...init.joints } : {},
        time: target.keys.length > 0 ? clampKeyTime(raw, target.duration, target.loop, fps) : raw,
        ease: init?.ease ?? ('inOut' as ClipKey['ease']),
        ...(init?.offsets ? { offsets: { ...init.offsets } } : {}),
      })
      normalizeKeys(target, fps)
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
      if (patch.name !== undefined) {
        const clean = patch.name.trim().slice(0, 64)
        if (clean) {
          const others = new Set(clip.keys.filter((k) => k.id !== keyId).map((k) => k.name))
          key.name = uniqueKeyName(clean, others)
        }
      }
      if (patch.time !== undefined) key.time = clampKeyTime(patch.time, clip.duration, clip.loop, fpsOf(state))
      if (patch.ease !== undefined) key.ease = patch.ease
      normalizeKeys(clip, fpsOf(state))
      state.dirty = true
    })
    get().animCommitStroke()
  },

  removeKey: (clipId, keyId) => {
    const st = get()
    const clip = st.clips.find((c) => c.id === clipId)
    if (!clip) return
    if (clip.keys.length > 0 && clip.keys[0].id === keyId) {
      showToast('The frame-1 key is locked — reset it to bind instead of deleting it')
      return
    }
    get().animBeginStroke()
    set((state) => {
      const target = state.clips.find((c) => c.id === clipId)
      if (!target) return
      const removedIndex = target.keys.findIndex((k) => k.id === keyId)
      target.keys = target.keys.filter((k) => k.id !== keyId)
      // The selection follows the removal: nearest survivor at the same slot, else the
      // last key, else null when the clip emptied.
      if (state.selectedKeyId === keyId) {
        state.selectedKeyId = target.keys.length > 0
          ? target.keys[Math.min(Math.max(removedIndex, 0), target.keys.length - 1)].id
          : null
      }
      normalizeKeys(target, fpsOf(state))
      state.dirty = true
    })
    get().animCommitStroke()
  },

  duplicateKey: (clipId, keyId) => {
    let newId: string | null = null
    get().animBeginStroke()
    set((state) => {
      const clip = state.clips.find((c) => c.id === clipId)
      const key = clip?.keys.find((k) => k.id === keyId)
      if (!clip || !key) return
      newId = newKeyId()
      const taken = new Set(clip.keys.map((k) => k.name))
      const joints: Record<string, JointEuler> = {}
      for (const [jointId, euler] of Object.entries(key.joints)) joints[jointId] = [...euler] as JointEuler
      const fps = fpsOf(state)
      const copy: ClipKey = {
        id: newId,
        name: uniqueKeyName(key.name, taken),
        time: clampKeyTime(key.time + 1 / fps, clip.duration, clip.loop, fps),
        ease: key.ease,
        joints,
        ...(key.offsets ? { offsets: { ...key.offsets } } : {}),
      }
      clip.keys.push(copy)
      normalizeKeys(clip, fps)
      state.selectedKeyId = newId
      state.dirty = true
    })
    get().animCommitStroke()
    return newId
  },

  mirrorKey: (clipId, keyId) => {
    const st = get()
    const clip = st.clips.find((c) => c.id === clipId)
    const key = clip?.keys.find((k) => k.id === keyId)
    if (!clip || !key) return null
    // Names pair the joints, so mirror against the live outline (the UI always flips X).
    const mirrored = mirrorJoints({ joints: key.joints, offsets: key.offsets }, st.rigBoxes, 'x')
    get().animBeginStroke()
    set((state) => {
      const target = state.clips.find((c) => c.id === clipId)?.keys.find((k) => k.id === keyId)
      if (!target) return
      target.joints = { ...mirrored.joints }
      if (mirrored.offsets) target.offsets = { ...mirrored.offsets }
      else delete target.offsets
      state.dirty = true
    })
    get().animCommitStroke()
    return keyId
  },

  resetKey: (clipId, keyId) => {
    get().animBeginStroke()
    set((state) => {
      const key = state.clips.find((c) => c.id === clipId)?.keys.find((k) => k.id === keyId)
      if (!key) return
      key.joints = {}
      delete key.offsets
      state.dirty = true
    })
    get().animCommitStroke()
  },

  setPoseDragging: (dragging) => {
    set((state) => {
      state.poseDragging = dragging
    })
  },
})
