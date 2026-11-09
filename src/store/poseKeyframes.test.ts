import { beforeEach, describe, expect, it } from 'vitest'
import { previewFrame } from '@/engine/rigging/preview'
import { CLIP_FRAME_SECONDS } from '@/engine/rigging/types'
import { useAppStore } from './useAppStore'
import { clampKeyTime } from './poseSlice'

function addBox(id: string, name?: string) {
  useAppStore.getState().addRigBox({ id, name: name ?? id, min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot: null, tweens: [] })
}

/** Clip list order (the first clip supplies the assembly pose on export). */
describe('moveClip', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function threeClips(): string[] {
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    // addClip uniquifies: Clip, Clip 2, Clip 3.
    return [s.addClip(), s.addClip(), s.addClip()]
  }

  it('reorders before/after and to the end', () => {
    const [a, b, c] = threeClips()
    const s = useAppStore.getState()
    const names = () => useAppStore.getState().clips.map((x) => x.name)
    expect(names()).toEqual(['Clip', 'Clip 2', 'Clip 3'])

    // Move the first after the last.
    s.moveClip(a, c, 'after')
    expect(names()).toEqual(['Clip 2', 'Clip 3', 'Clip'])
    // Move the last before the first.
    s.moveClip(a, b, 'before')
    expect(names()).toEqual(['Clip', 'Clip 2', 'Clip 3'])
    // Null target appends at the end.
    s.moveClip(b, null, 'after')
    expect(names()).toEqual(['Clip', 'Clip 3', 'Clip 2'])
  })

  it('ignores unknown ids and self-drops, and undoes as one entry', () => {
    const [a, b] = threeClips()
    const s = useAppStore.getState()
    const animBefore = useAppStore.getState().animPast.length
    s.moveClip('nope', a, 'before')
    s.moveClip(a, 'nope', 'before')
    s.moveClip(a, a, 'before')
    expect(useAppStore.getState().clips.map((x) => x.id)).toEqual([a, b, expect.any(String)])
    expect(useAppStore.getState().animPast.length).toBe(animBefore)

    s.moveClip(b, a, 'before')
    expect(useAppStore.getState().clips[0].id).toBe(b)
    expect(useAppStore.getState().animPast.length).toBe(animBefore + 1)
    s.animUndo()
    expect(useAppStore.getState().clips[0].id).toBe(a)
  })
})
/** Poses a key directly — edits land in the key, no staging. */
function poseKey(clipId: string, keyId: string, joints: Record<string, [number, number, number]>) {
  const s = useAppStore.getState()
  for (const [id, euler] of Object.entries(joints)) s.setKeyJoint(clipId, keyId, id, euler)
}

/** Poses the fresh clip's frame-1 anchor (in poses mode) and returns both ids. */
function keyframeAt(time: number, joints: Record<string, [number, number, number]>): { clipId: string; keyId: string } {
  const s = useAppStore.getState()
  s.setAnimationMode('poses')
  const clipId = s.addClip()
  const st = useAppStore.getState()
  const keyId = st.selectedKeyId!
  poseKey(clipId, keyId, joints)
  if (time !== 0) st.patchKey(clipId, keyId, { time })
  return { clipId, keyId }
}

/** The pose is the keyframe: capture, selection, and transport lifecycle. */
describe('keyframe capture', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('keys a bind frame at the playhead and selects it', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const clipId = s.addClip()
    // The fresh clip already holds its frame-1 anchor (bind).
    expect(useAppStore.getState().clips[0].keys.map((k) => k.name)).toEqual(['Key 1'])
    const keyId = s.addKeyframe(clipId, 0.5)!
    const clip = useAppStore.getState().clips[0]
    expect(clip.keys).toHaveLength(2)
    expect(clip.keys[0].time).toBe(0)
    expect(clip.keys[1].time).toBeCloseTo(0.5, 10)
    expect(clip.keys[1].joints).toEqual({})
    expect(clip.keys[1].name).toBe('Key 2')
    expect(useAppStore.getState().selectedKeyId).toBe(keyId)
    // A bind key shows bind in the preview.
    expect(previewFrame(useAppStore.getState(), 99).pose.get('arm')).toBeUndefined()
  })

  it('keys a sampled mid-tween blend with the segment ease', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const clipId = s.addClip()
    const anchor = useAppStore.getState().selectedKeyId!
    poseKey(clipId, anchor, { arm: [0, Math.PI / 2, 0] })
    // Frame 15 of a 1 s in-out swing out of the anchor: freeze the blend there.
    const mid = s.addKeyframe(clipId, 0.5, {
      joints: { arm: [0, Math.PI / 4, 0] },
      ease: 'inOut',
    })!
    const clip = useAppStore.getState().clips[0]
    expect(clip.keys).toHaveLength(2)
    expect(clip.keys[1].time).toBeCloseTo(0.5, 10)
    expect(clip.keys[1].joints).toEqual({ arm: [0, Math.PI / 4, 0] })
    expect(clip.keys[1].ease).toBe('inOut')
    expect(clip.keys[1].offsets).toBeUndefined()
    expect(useAppStore.getState().selectedKeyId).toBe(mid)
  })

  it('appends past the last key off the timeline', () => {
    addBox('arm')
    const s = useAppStore.getState()
    const clipId = s.addClip()
    poseKey(clipId, useAppStore.getState().selectedKeyId!, { arm: [0.5, 0, 0] })
    const second = s.addKeyframe(clipId, 0)!
    poseKey(clipId, second, { arm: [0, 0.5, 0] })
    const k1 = s.addKeyframe(clipId)!
    const clip = useAppStore.getState().clips[0]
    // Anchor at 0, keyed pose one frame later, appended half a second past that.
    expect(clip.keys).toHaveLength(3)
    expect(clip.keys[0].time).toBe(0)
    expect(clip.keys[1].time).toBeCloseTo(CLIP_FRAME_SECONDS, 10)
    expect(clip.keys[2].time).toBeCloseTo(CLIP_FRAME_SECONDS + 0.5, 10)
    expect(clip.keys.find((k) => k.id === second)?.joints).toEqual({ arm: [0, 0.5, 0] })
    expect(clip.keys.find((k) => k.id === k1)?.joints).toEqual({})
    expect(useAppStore.getState().selectedKeyId).toBe(k1)
  })

  it('snaps keyframes to the project frame rate', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setFps(12)
    expect(useAppStore.getState().meta.fps).toBe(12)
    const clipId = s.addClip()
    poseKey(clipId, useAppStore.getState().selectedKeyId!, { arm: [0.5, 0, 0] })
    const second = s.addKeyframe(clipId, 0)!
    poseKey(clipId, second, { arm: [0, 0.5, 0] })
    // 0.05 s snaps to the nearest 1/12 s frame, not the 30 fps grid.
    const keyId = s.addKeyframe(clipId, 0.05)!
    expect(useAppStore.getState().clips[0].keys.find((k) => k.id === keyId)?.time).toBeCloseTo(1 / 12, 10)
    // Out-of-range fps values clamp into 1–120.
    s.setFps(0)
    expect(useAppStore.getState().meta.fps).toBe(1)
  })

  it('deleting a box strips its joints from keys', () => {
    addBox('arm')
    addBox('leg')
    const s = useAppStore.getState()
    const clipId = s.addClip()
    poseKey(clipId, useAppStore.getState().selectedKeyId!, { arm: [0.5, 0, 0], leg: [0, 0.25, 0] })
    s.deleteRigBox('arm')
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ leg: [0, 0.25, 0] })
  })

  it('stopping transport keeps the key selection and the frozen frame', () => {
    addBox('arm')
    const { keyId } = keyframeAt(0, { arm: [0.5, 0, 0] })
    expect(useAppStore.getState().selectedKeyId).toBe(keyId)
    const s = useAppStore.getState()
    s.setClipTime(1)
    s.setClipPlaying(true)
    s.setClipPlaying(false)
    const st = useAppStore.getState()
    expect(st.selectedKeyId).toBe(keyId)
    expect(st.clipPlaying).toBe(false)
    // Pausing freezes the playhead where it stopped — a number, never null.
    expect(st.clipTime).not.toBeNull()
  })
})

/** Clip CRUD + transport (unchanged mechanics, new key shape). */
describe('pose clips', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('adds, renames, patches, and deletes clips on the animate undo stack', () => {
    addBox('arm')
    const s = useAppStore.getState()
    const id = s.addClip()
    expect(useAppStore.getState().clips).toHaveLength(1)
    expect(useAppStore.getState().activeClipId).toBe(id)
    s.renameClip(id, 'walk')
    expect(useAppStore.getState().clips[0].name).toBe('walk')
    // glTF-unsafe names sanitize on rename.
    s.renameClip(id, 'my walk!')
    expect(useAppStore.getState().clips[0].name).toBe('my_walk')
    // Duration snaps and floors (looping clips hold a frame past the last key).
    s.patchClip(id, { duration: 0 })
    expect(useAppStore.getState().clips[0].duration).toBeGreaterThan(0)
    s.deleteClip(id)
    expect(useAppStore.getState().clips).toHaveLength(0)
    expect(useAppStore.getState().activeClipId).toBeNull()
    // Delete undoes.
    s.animUndo()
    expect(useAppStore.getState().clips).toHaveLength(1)
  })

  it('adds, retimes, and removes keys with the first locked at 0', () => {
    addBox('arm')
    const s = useAppStore.getState()
    const clipId = s.addClip()
    // The fresh clip's selected Key 1 is the frame-1 anchor — pose it directly.
    const k0 = useAppStore.getState().selectedKeyId!
    poseKey(clipId, k0, { arm: [0.5, 0, 0] })
    const k1 = s.addKeyframe(clipId, 1)!
    poseKey(clipId, k1, { arm: [0, 0.5, 0] })
    let clip = useAppStore.getState().clips[0]
    // New keys obey the strip scale like retimes: at the loop end they land one frame
    // shy, and the duration floor holds (last + one frame = the second, unchanged).
    expect(clip.keys.map((k) => k.time)).toEqual([0, 1 - CLIP_FRAME_SECONDS])
    expect(clip.duration).toBeCloseTo(1, 10)
    // Retiming the first key clamps back to 0.
    s.patchKey(clipId, k0, { time: 0.5 })
    clip = useAppStore.getState().clips[0]
    expect(clip.keys[0].time).toBe(0)
    // Removing the selected key re-points the selection at the surviving anchor.
    s.setSelectedKey(k1)
    s.removeKey(clipId, k1)
    expect(useAppStore.getState().clips[0].keys.map((k) => k.id)).toEqual([k0])
    expect(useAppStore.getState().selectedKeyId).toBe(k0)
    // Key add/remove undo together with the rest of the animate stack.
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys).toHaveLength(2)
    // The frame-1 anchor refuses deletion — reset it to bind instead.
    s.removeKey(clipId, k0)
    expect(useAppStore.getState().clips[0].keys.map((k) => k.id)).toEqual([k0, k1])
  })

  it('renames keys through patchKey, uniquified within the clip', () => {
    addBox('arm')
    const { clipId } = keyframeAt(0, { arm: [0.5, 0, 0] })
    const s = useAppStore.getState()
    const k0 = useAppStore.getState().clips[0].keys[0].id
    s.patchKey(clipId, k0, { name: 'contact' })
    expect(useAppStore.getState().clips[0].keys[0].name).toBe('contact')
    const k1 = s.addKeyframe(clipId, 1)!
    poseKey(clipId, k1, { arm: [0, 0.5, 0] })
    s.patchKey(clipId, k1, { name: 'contact' })
    expect(useAppStore.getState().clips[0].keys.find((k) => k.id === k1)?.name).toBe('contact 2')
    // Empty names are ignored.
    s.patchKey(clipId, k1, { name: '   ' })
    expect(useAppStore.getState().clips[0].keys.find((k) => k.id === k1)?.name).toBe('contact 2')
  })

  it('plays/stops transport and seeks the playhead', () => {
    addBox('arm')
    const { clipId } = keyframeAt(0, { arm: [0.5, 0, 0] })
    const s = useAppStore.getState()
    s.setClipPlaying(true)
    expect(useAppStore.getState().clipPlaying).toBe(true)
    s.setClipPlaying(false)
    expect(useAppStore.getState().clipPlaying).toBe(false)
    s.setClipTime(1.5)
    expect(useAppStore.getState().clipTime).toBeCloseTo(1.5, 10)
    // Playing without an active clip is a no-op.
    s.setActiveClip(null)
    s.setClipPlaying(true)
    expect(useAppStore.getState().clipPlaying).toBe(false)
    expect(clipId).toBeTruthy()
  })
})

/** Direct keyframe writes: the gizmo and joint card land in the selected key. */
describe('direct keyframe edits', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('setKeyJoint writes into the key and collapses bind, one undo entry per call', () => {
    addBox('arm')
    const { clipId, keyId } = keyframeAt(0, { arm: [0.5, 0, 0] })
    const s = useAppStore.getState()
    const before = s.animPast.length
    s.setKeyJoint(clipId, keyId, 'arm', [0, 0.75, 0])
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ arm: [0, 0.75, 0] })
    expect(useAppStore.getState().animPast.length).toBe(before + 1)
    // Near-zero collapses back to bind (the entry drops out of the sparse map).
    s.setKeyJoint(clipId, keyId, 'arm', [1e-12, 0, 0])
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({})
    // Unknown joints are a no-op.
    s.setKeyJoint(clipId, keyId, 'ghost', [0.5, 0, 0])
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({})
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ arm: [0, 0.75, 0] })
  })

  it('setKeyJoint addresses keys explicitly, independent of selection', () => {
    addBox('arm')
    const { clipId, keyId } = keyframeAt(0, { arm: [0.5, 0, 0] })
    const s = useAppStore.getState()
    // Deselect: explicit writes still land (entry points refuse instead when nothing
    // is selected — the store itself never stages).
    s.setSelectedKey(null)
    s.setKeyJoint(clipId, keyId, 'arm', [0, 0.75, 0])
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ arm: [0, 0.75, 0] })
    // Editing shows live in the paused frame.
    s.setSelectedKey(keyId)
    s.setClipTime(0)
    s.setKeyJoint(clipId, keyId, 'arm', [0, 0, 0.9])
    expect(previewFrame(useAppStore.getState(), 99).pose.get('arm')).toEqual([0, 0, 0.9])
  })

  it('duplicateKey copies the pose one frame later and selects the copy', () => {
    addBox('arm')
    const { clipId, keyId } = keyframeAt(0, { arm: [0.5, 0, 0] })
    const s = useAppStore.getState()
    const dupe = s.duplicateKey(clipId, keyId)!
    const clip = useAppStore.getState().clips[0]
    expect(clip.keys).toHaveLength(2)
    const copy = clip.keys.find((k) => k.id === dupe)!
    expect(copy.joints).toEqual({ arm: [0.5, 0, 0] })
    expect(copy.time).toBeCloseTo(CLIP_FRAME_SECONDS, 10)
    expect(copy.name).toBe('Key 1 2')
    expect(useAppStore.getState().selectedKeyId).toBe(dupe)
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys).toHaveLength(1)
  })

  it('mirrorKey mirrors the pose in place, keeping name, time, and selection', () => {
    addBox('l')
    addBox('r')
    useAppStore.getState().renameRigBox('l', 'arm_L')
    useAppStore.getState().renameRigBox('r', 'arm_R')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const clipId = s.addClip()
    const keyId = useAppStore.getState().selectedKeyId!
    s.setKeyJoint(clipId, keyId, 'l', [0.5, 0.2, 0])
    const before = useAppStore.getState().clips[0].keys[0]
    // On the timeline (scrubbed): the mirror still lands on the selected key.
    s.setClipTime(0.5)
    const mid = s.mirrorKey(clipId, keyId)!
    expect(mid).toBe(keyId)
    const clip = useAppStore.getState().clips[0]
    // No new keyframe — the pose flips inside the same key.
    expect(clip.keys).toHaveLength(1)
    const mirrored = clip.keys[0]
    expect(mirrored.name).toBe(before.name)
    expect(mirrored.time).toBe(0)
    // Paired swap: the keyed left joint lands mirrored on the right, left stays bind.
    expect(mirrored.joints).toEqual({ r: [0.5, -0.2, 0] })
    expect(useAppStore.getState().selectedKeyId).toBe(keyId)
    // Undo restores the unmirrored pose.
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ l: [0.5, 0.2, 0] })
  })

  it('mirrorKey returns null for unknown ids and mirrors twice back to start', () => {
    addBox('arm')
    const { clipId, keyId } = keyframeAt(0, { arm: [0.5, 0.2, 0.3] })
    const s = useAppStore.getState()
    expect(s.mirrorKey(clipId, 'ghost')).toBeNull()
    expect(s.mirrorKey('ghost', keyId)).toBeNull()
    // Unpaired joints negate Y/Z in place — mirroring twice restores the pose.
    s.mirrorKey(clipId, keyId)
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ arm: [0.5, -0.2, -0.3] })
    s.mirrorKey(clipId, keyId)
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ arm: [0.5, 0.2, 0.3] })
  })

  it('resetKey clears a keyframe back to bind', () => {
    addBox('arm')
    const { clipId, keyId } = keyframeAt(0, { arm: [0.5, 0, 0] })
    const s = useAppStore.getState()
    s.resetKey(clipId, keyId)
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({})
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ arm: [0.5, 0, 0] })
  })

  it('setKeyOffset writes offsets and zeroes them out', () => {
    addBox('hips')
    const { clipId, keyId } = keyframeAt(0, {})
    const s = useAppStore.getState()
    s.setKeyOffset(clipId, keyId, 'hips', [0, 1.5, 0])
    expect(useAppStore.getState().clips[0].keys[0].offsets).toEqual({ hips: [0, 1.5, 0] })
    // The bob shows in the preview worlds.
    expect(previewFrame(useAppStore.getState(), 99).off.get('hips')).toEqual([0, 1.5, 0])
    // Zeroing out collapses back to absent.
    s.setKeyOffset(clipId, keyId, 'hips', [0, 0, 0])
    expect(useAppStore.getState().clips[0].keys[0].offsets).toBeUndefined()
  })

  it('setKeyOffset writes child offsets but refuses unknown boxes', () => {
    addBox('hips')
    useAppStore.getState().addRigBox({ id: 'shin', name: 'shin', min: [0, 0, 0], max: [1, 1, 1], parentId: 'hips', pivot: null, tweens: [] })
    const { clipId, keyId } = keyframeAt(0, {})
    const s = useAppStore.getState()
    // A child shift composes inside its parent's chain — assembly lives here.
    s.setKeyOffset(clipId, keyId, 'shin', [0, 1, 0])
    expect(useAppStore.getState().clips[0].keys[0].offsets).toEqual({ shin: [0, 1, 0] })
    expect(previewFrame(useAppStore.getState(), 99).off.get('shin')).toEqual([0, 1, 0])
    // Unknown ids are still a no-op.
    s.setKeyOffset(clipId, keyId, 'ghost', [0, 1, 0])
    expect(useAppStore.getState().clips[0].keys[0].offsets).toEqual({ shin: [0, 1, 0] })
  })

  it('scrubbing to 0 shows the first key', () => {
    addBox('arm')
    keyframeAt(0, { arm: [0.5, 0, 0] })
    const s = useAppStore.getState()
    // A later key disagrees — on the timeline at 0, key 0 wins.
    const clipId = useAppStore.getState().activeClipId!
    const second = s.addKeyframe(clipId, 1)!
    poseKey(clipId, second, { arm: [0, 0, 0.9] })
    s.setClipTime(0)
    expect(useAppStore.getState().clipTime).not.toBeNull()
    expect(previewFrame(useAppStore.getState(), 99).pose.get('arm')).toEqual([0.5, 0, 0])
  })
})

/** Strip retime semantics (sort, snap, first-key lock, one undo entry per drag). */
describe('clip editor', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function twoKeys(): { clipId: string; k: string[] } {
    addBox('arm')
    const s = useAppStore.getState()
    const clipId = s.addClip()
    // The fresh clip's selected Key 1 is the frame-1 anchor — pose it directly.
    const k0 = useAppStore.getState().selectedKeyId!
    s.setKeyJoint(clipId, k0, 'arm', [0.5, 0, 0])
    const k1 = s.addKeyframe(clipId, 1)!
    s.setKeyJoint(clipId, k1, 'arm', [0, 0.5, 0])
    return { clipId, k: [k0, k1] }
  }

  // NOTE: addKeyframe(clipId) with no time appends half a second past the last key
  // (0.5 past a single key at 0) — tests that need exact times pass them explicitly.

  it('retiming sorts keys by time and locks the first at 0', () => {
    const { clipId, k } = twoKeys()
    const s = useAppStore.getState()
    const k2 = s.addKeyframe(clipId, 2)!
    poseKey(clipId, k2, { arm: [0, 0, 0.9] })
    // Drag the last key into the middle — the strip order follows time, not insertion.
    s.patchKey(clipId, k2, { time: 0.5 })
    let clip = useAppStore.getState().clips[0]
    expect(clip.keys.map((k) => k.id)).toEqual([k[0], k2, k[1]])
    expect(clip.keys.map((k) => k.time)).toEqual([0, 0.5, 1 - CLIP_FRAME_SECONDS])
    // The first key never leaves 0, however far it is dragged (it stays first here).
    s.patchKey(clipId, k[0], { time: 0.4 })
    clip = useAppStore.getState().clips[0]
    expect(clip.keys[0].id).toBe(k[0])
    expect(clip.keys[0].time).toBe(0)
  })

  it('snaps retimed keys to 1/30 s', () => {
    const { clipId, k } = twoKeys()
    const s = useAppStore.getState()
    s.patchKey(clipId, k[1], { time: 0.05 })
    // 0.05 s sits halfway between frames 1 and 2 — rounds to 2/30 s.
    expect(useAppStore.getState().clips[0].keys[1].time).toBeCloseTo(2 / 30, 10)
  })

  it('clamps retimed keys to the clip end, one frame shy when looping', () => {
    const { clipId, k } = twoKeys()
    const s = useAppStore.getState()
    const duration = useAppStore.getState().clips[0].duration
    // Looping (the default): the wrap span keeps its frame, so the key stops one short
    // and the duration never moves — the strip scale stays fixed mid-drag.
    s.patchKey(clipId, k[1], { time: 99 })
    let clip = useAppStore.getState().clips[0]
    expect(clip.keys[1].time).toBeCloseTo(duration - CLIP_FRAME_SECONDS, 10)
    expect(clip.duration).toBe(duration)
    // One-shot: the key may sit exactly on the end, but never past it.
    s.patchClip(clipId, { loop: false })
    s.patchKey(clipId, k[1], { time: 99 })
    clip = useAppStore.getState().clips[0]
    expect(clip.keys[1].time).toBeCloseTo(clip.duration, 10)
    expect(clip.duration).toBe(duration)
    // The inspector path clamps the same way (it commits through patchKey).
    s.patchKey(clipId, k[1], { time: -5 })
    clip = useAppStore.getState().clips[0]
    expect(clip.keys[1].time).toBeCloseTo(CLIP_FRAME_SECONDS, 10)
  })

  it('clampKeyTime pins times to the strip scale', () => {
    expect(clampKeyTime(-1, 1, false)).toBe(CLIP_FRAME_SECONDS)
    expect(clampKeyTime(0, 1, false)).toBe(CLIP_FRAME_SECONDS)
    expect(clampKeyTime(0.05, 1, false)).toBeCloseTo(2 / 30, 10)
    expect(clampKeyTime(99, 1, false)).toBe(1)
    expect(clampKeyTime(99, 1, true)).toBeCloseTo(1 - CLIP_FRAME_SECONDS, 10)
  })

  it('brackets a marker drag as a single undo entry', () => {
    const { clipId, k } = twoKeys()
    const s = useAppStore.getState()
    const before = useAppStore.getState().animPast.length
    // The strip opens one stroke on pointer-down and commits on pointer-up.
    s.animBeginStroke()
    s.patchKey(clipId, k[1], { time: 0.4 })
    s.patchKey(clipId, k[1], { time: 0.6 })
    s.animCommitStroke()
    expect(useAppStore.getState().animPast.length).toBe(before + 1)
    expect(useAppStore.getState().clips[0].keys[1].time).toBeCloseTo(0.6, 10)
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys[1].time).toBeCloseTo(1 - CLIP_FRAME_SECONDS, 10)
  })
})

/** Grab-time key healing (gizmo/offset drags never go dead for want of a key). */
describe('ensureKeyframeSelected', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('creates the assembly clip when none exists and selects its anchor', () => {
    addBox('arm')
    expect(useAppStore.getState().clips).toHaveLength(0)
    expect(useAppStore.getState().ensureKeyframeSelected()).toBe(true)
    const after = useAppStore.getState()
    expect(after.clips).toHaveLength(1)
    expect(after.activeClipId).toBe(after.clips[0].id)
    expect(after.selectedKeyId).toBe(after.clips[0].keys[0].id)
  })

  it('selects the active clip’s first key when none is under edit', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const clipId = s.addClip()
    const k1 = s.addKeyframe(clipId, 0.5)!
    s.setSelectedKey(k1)
    // Deselect (timeline cleared, e.g. post-reload): the grab re-selects Key 1.
    s.setSelectedKey(null)
    expect(useAppStore.getState().ensureKeyframeSelected()).toBe(true)
    const after = useAppStore.getState()
    expect(after.selectedKeyId).toBe(after.clips[0].keys[0].id)
  })

  it('is a no-op when a key is already under edit', () => {
    addBox('arm')
    keyframeAt(0, { arm: [0.5, 0, 0] })
    const before = useAppStore.getState()
    expect(useAppStore.getState().ensureKeyframeSelected()).toBe(true)
    const after = useAppStore.getState()
    expect(after.selectedKeyId).toBe(before.selectedKeyId)
    expect(after.clips).toHaveLength(before.clips.length)
  })
})

/** 2D offset drags (Offset tool): the keyframe offset follows the pointer. */
describe('offsetMove gesture', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('drags the offset live and commits one undo entry', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const clipId = s.addClip()
    const keyId = useAppStore.getState().selectedKeyId!
    const animBefore = useAppStore.getState().animPast.length

    expect(s.beginOffsetMove('arm')).toBe(true)
    s.updateOffsetMove([2, 0, 0])
    expect(useAppStore.getState().clips[0].keys[0].offsets).toEqual({ arm: [2, 0, 0] })
    s.updateOffsetMove([2, 0, 0])
    s.endOffsetMove()

    expect(useAppStore.getState().clips[0].keys[0].offsets).toEqual({ arm: [2, 0, 0] })
    expect(useAppStore.getState().animPast.length).toBe(animBefore + 1)
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys[0].offsets).toBeUndefined()
    expect(clipId).toBe(useAppStore.getState().clips[0].id)
    expect(keyId).toBe(useAppStore.getState().clips[0].keys[0].id)
  })

  it('snaps to thirds on release and records nothing for a tap', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    s.addClip()
    const animBefore = useAppStore.getState().animPast.length

    expect(s.beginOffsetMove('arm')).toBe(true)
    s.updateOffsetMove([0.5, 0, 0])
    // The lattice engages live, not just on release: the written total is already thirds.
    expect(useAppStore.getState().clips[0].keys[0].offsets?.arm?.[0]).toBeCloseTo(2 / 3, 10)
    s.endOffsetMove()
    // 0.5 snaps to the nearest third (1/2 is equidistant — Math.round ties up).
    expect(useAppStore.getState().clips[0].keys[0].offsets?.arm?.[0]).toBeCloseTo(2 / 3, 10)

    const animAfterDrag = useAppStore.getState().animPast.length
    expect(s.beginOffsetMove('arm')).toBe(true)
    s.endOffsetMove()
    expect(useAppStore.getState().animPast.length).toBe(animAfterDrag)
    expect(animAfterDrag).toBe(animBefore + 1)
  })

  it('refuses unknown boxes and arms nothing', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    s.addClip()
    expect(s.beginOffsetMove('ghost')).toBe(false)
    s.updateOffsetMove([3, 0, 0])
    s.endOffsetMove()
    expect(useAppStore.getState().clips[0].keys[0].offsets).toBeUndefined()
  })

  it('auto-creates the assembly clip when none exists', () => {
    addBox('arm')
    const s = useAppStore.getState()
    expect(s.beginOffsetMove('arm')).toBe(true)
    s.updateOffsetMove([1, 0, 0])
    s.endOffsetMove()
    const after = useAppStore.getState()
    expect(after.clips).toHaveLength(1)
    expect(after.clips[0].keys[0].offsets).toEqual({ arm: [1, 0, 0] })
  })
})
