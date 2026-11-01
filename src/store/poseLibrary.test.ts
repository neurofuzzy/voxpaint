import { beforeEach, describe, expect, it } from 'vitest'
import { previewFrame } from '@/engine/rigging/preview'
import { CLIP_FRAME_SECONDS } from '@/engine/rigging/types'
import { useAppStore } from './useAppStore'
import { clampKeyTime } from './poseSlice'

/** Named pose snapshots: captured from scratch, staged for preview, undoable + persisted. */
describe('pose library', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string) {
    useAppStore.getState().addRigBox({ id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot: null, tweens: [] })
  }

  it('captures the scratch into a staged pose and clears the scratch', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    const id = s.capturePose()
    expect(id).toBeTruthy()
    const poses = useAppStore.getState().poses
    expect(poses).toHaveLength(1)
    expect(poses[0].name).toBe('Pose')
    expect(poses[0].joints).toEqual({ arm: [0.5, 0, 0] })
    // Staged for preview; scratch cleared so the gizmo starts clean.
    expect(useAppStore.getState().stagedPoseId).toBe(id)
    expect(useAppStore.getState().poseRotations.size).toBe(0)
  })

  it('refuses to capture an empty scratch', () => {
    addBox('arm')
    expect(useAppStore.getState().capturePose()).toBeNull()
    expect(useAppStore.getState().poses).toHaveLength(0)
  })

  it('renames, stages/unstages, and deletes poses on the animate undo stack', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    const id = s.capturePose()!
    s.renamePose(id, 'wave')
    expect(useAppStore.getState().poses[0].name).toBe('wave')
    // Unstage back to the (empty) scratch.
    s.stagePose(null)
    expect(useAppStore.getState().stagedPoseId).toBeNull()
    s.stagePose(id)
    expect(useAppStore.getState().stagedPoseId).toBe(id)
    s.deletePose(id)
    expect(useAppStore.getState().poses).toHaveLength(0)
    expect(useAppStore.getState().stagedPoseId).toBeNull()
    // Delete undoes.
    s.animUndo()
    expect(useAppStore.getState().poses).toHaveLength(1)
  })

  it('adopting a staged pose seeds the scratch and unstages', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    s.capturePose()
    // Adopt copies staged joints into the scratch and unstages.
    s.adoptStagedPose()
    expect(useAppStore.getState().poseRotations.get('arm')).toEqual([0.5, 0, 0])
    expect(useAppStore.getState().stagedPoseId).toBeNull()
  })

  it('resetPose clears scratch and staging together', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    const id = s.capturePose()!
    expect(useAppStore.getState().stagedPoseId).toBe(id)
    s.resetPose()
    expect(useAppStore.getState().stagedPoseId).toBeNull()
    expect(useAppStore.getState().poseRotations.size).toBe(0)
  })

  it('deleting a box strips its joints from poses', () => {
    addBox('arm')
    addBox('leg')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    s.setJointRotation('leg', [0, 0.25, 0])
    s.capturePose()
    s.deleteRigBox('arm')
    const poses = useAppStore.getState().poses
    expect(poses).toHaveLength(1)
    expect(poses[0].joints).toEqual({ leg: [0, 0.25, 0] })
  })

  it('staging an unknown id unstages', () => {
    useAppStore.getState().stagePose('ghost')
    expect(useAppStore.getState().stagedPoseId).toBeNull()
  })
})

describe('pose clips', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string) {
    useAppStore.getState().addRigBox({ id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot: null, tweens: [] })
  }

  function twoPoses(): [string, string] {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    const a = s.capturePose()!
    s.setJointRotation('arm', [0, 0.5, 0])
    const b = s.capturePose()!
    return [a, b]
  }

  it('adds, renames, patches, and deletes clips on the animate undo stack', () => {
    twoPoses()
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
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    const id = s.addClip()
    const k0 = s.addKey(id, a, 0)!
    const k1 = s.addKey(id, b, 1)!
    let clip = useAppStore.getState().clips[0]
    expect(clip.keys.map((k) => [k.poseId, k.time])).toEqual([[a, 0], [b, 1]])
    // A looping clip holds duration a frame past its last key.
    expect(clip.duration).toBeCloseTo(1 + 1 / 30, 10)
    // Retiming the first key clamps back to 0.
    s.patchKey(id, k0, { time: 0.5 })
    clip = useAppStore.getState().clips[0]
    expect(clip.keys[0].time).toBe(0)
    s.removeKey(id, k1)
    expect(useAppStore.getState().clips[0].keys.map((k) => k.id)).toEqual([k0])
    // Key add/remove undo together with the rest of the animate stack.
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys).toHaveLength(2)
  })

  it('plays/stops transport and seeks the playhead', () => {
    const [a] = twoPoses()
    const s = useAppStore.getState()
    const id = s.addClip()
    s.addKey(id, a, 0)
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
  })

  it('deleting a referenced pose drops its keys', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    const id = s.addClip()
    s.addKey(id, a, 0)
    s.addKey(id, b, 1)
    s.deletePose(a)
    const clip = useAppStore.getState().clips[0]
    expect(clip.keys.map((k) => k.poseId)).toEqual([b])
    // The surviving key re-locks to 0.
    expect(clip.keys[0].time).toBe(0)
  })

  it('overwrites a pose from the scratch and clears it', () => {
    const [a] = twoPoses()
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    s.setJointRotation('arm', [0, 0, 0.75])
    s.overwritePose(a)
    expect(useAppStore.getState().poses[0].joints).toEqual({ arm: [0, 0, 0.75] })
    expect(useAppStore.getState().poseRotations.size).toBe(0)
    // The saved pose stages so the preview keeps showing it instead of dropping to bind.
    expect(useAppStore.getState().stagedPoseId).toBe(a)
    expect(useAppStore.getState().clipTime).toBeNull()
    expect(previewFrame(useAppStore.getState(), 99).pose.get('arm')).toEqual([0, 0, 0.75])
    // Empty scratch is a no-op with no pose created.
    expect(useAppStore.getState().capturePose()).toBeNull()
  })

  it('grabbing for edit freezes the clip frame into the scratch and stops transport', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const id = s.addClip()
    s.addKey(id, a, 0)
    s.addKey(id, b, 1)
    // Stage + grab: scratch takes the staged joints, staging clears.
    s.stagePose(a)
    s.grabPoseForEdit()
    expect(useAppStore.getState().poseRotations.get('arm')).toEqual([0.5, 0, 0])
    expect(useAppStore.getState().stagedPoseId).toBeNull()
    // Scrubbed frame + grab: scratch takes the exact key frame.
    s.setClipTime(1)
    s.grabPoseForEdit()
    expect(useAppStore.getState().poseRotations.get('arm')).toEqual([0, 0.5, 0])
    // Playing + grab: scratch takes the in-flight frame, transport stops.
    s.setClipTime(0)
    s.setClipPlaying(true)
    s.grabPoseForEdit()
    expect(useAppStore.getState().clipPlaying).toBe(false)
    expect(useAppStore.getState().poseRotations.has('arm')).toBe(true)
  })

  it('pausing then grabbing drops the playhead so gizmo edits show', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const id = s.addClip()
    s.addKey(id, a, 0)
    s.addKey(id, b, 1)
    // Pause mid-clip: the playhead freezes as a number and the frozen frame shows.
    s.setClipTime(1)
    s.setClipPlaying(true)
    s.setClipPlaying(false)
    expect(useAppStore.getState().clipTime).not.toBeNull()
    expect(previewFrame(useAppStore.getState(), 99).pose.get('arm')).toEqual([0, 0.5, 0])
    // Grabbing lands the frame in the scratch and steps off the timeline, so the
    // preview follows the scratch and the gizmo drag below changes what shows.
    s.grabPoseForEdit()
    expect(useAppStore.getState().clipTime).toBeNull()
    s.setJointRotation('arm', [0, 0, 0.9])
    expect(previewFrame(useAppStore.getState(), 99).pose.get('arm')).toEqual([0, 0, 0.9])
  })

  it('scrubbing to 0 shows the first key, not the scratch', () => {
    const [a] = twoPoses()
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const id = s.addClip()
    s.addKey(id, a, 0)
    // The scratch disagrees with key 0 — on the timeline at 0, key 0 wins.
    s.setJointRotation('arm', [0, 0, 0.9])
    s.setClipTime(0)
    expect(useAppStore.getState().clipTime).not.toBeNull()
    expect(previewFrame(useAppStore.getState(), 99).pose.get('arm')).toEqual([0.5, 0, 0])
  })
})

/** Step 3 clip-editor UX: strip retime semantics (sort, snap, first-key lock, one undo
 * entry per drag), the editing-target lifecycle, and + key defaults. */
describe('clip editor', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string) {
    useAppStore.getState().addRigBox({ id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot: null, tweens: [] })
  }

  function twoPoses(): [string, string] {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    const a = s.capturePose()!
    s.setJointRotation('arm', [0, 0.5, 0])
    const b = s.capturePose()!
    return [a, b]
  }

  it('retiming sorts keys by time and locks the first at 0', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    const id = s.addClip()
    const k0 = s.addKey(id, a, 0)!
    const k1 = s.addKey(id, b, 1)!
    const k2 = s.addKey(id, a, 2)!
    // Drag the last key into the middle — the strip order follows time, not insertion.
    s.patchKey(id, k2, { time: 0.5 })
    let clip = useAppStore.getState().clips[0]
    expect(clip.keys.map((k) => k.id)).toEqual([k0, k2, k1])
    expect(clip.keys.map((k) => k.time)).toEqual([0, 0.5, 1])
    // The first key never leaves 0, however far it is dragged (it stays first here).
    s.patchKey(id, k0, { time: 0.4 })
    clip = useAppStore.getState().clips[0]
    expect(clip.keys[0].id).toBe(k0)
    expect(clip.keys[0].time).toBe(0)
  })

  it('snaps retimed keys to 1/30 s', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    const id = s.addClip()
    s.addKey(id, a, 0)
    const k1 = s.addKey(id, b, 1)!
    s.patchKey(id, k1, { time: 0.05 })
    // 0.05 s sits halfway between frames 1 and 2 — rounds to 2/30 s.
    expect(useAppStore.getState().clips[0].keys[1].time).toBeCloseTo(2 / 30, 10)
  })

  it('clamps retimed keys to the clip end, one frame shy when looping', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    const id = s.addClip()
    s.addKey(id, a, 0)
    const k1 = s.addKey(id, b, 1)!
    const duration = useAppStore.getState().clips[0].duration
    // Looping (the default): the wrap span keeps its frame, so the key stops one short
    // and the duration never moves — the strip scale stays fixed mid-drag.
    s.patchKey(id, k1, { time: 99 })
    let clip = useAppStore.getState().clips[0]
    expect(clip.keys[1].time).toBeCloseTo(duration - CLIP_FRAME_SECONDS, 10)
    expect(clip.duration).toBe(duration)
    // One-shot: the key may sit exactly on the end, but never past it.
    s.patchClip(id, { loop: false })
    s.patchKey(id, k1, { time: 99 })
    clip = useAppStore.getState().clips[0]
    expect(clip.keys[1].time).toBeCloseTo(clip.duration, 10)
    expect(clip.duration).toBe(duration)
    // The inspector path clamps the same way (it commits through patchKey).
    s.patchKey(id, k1, { time: -5 })
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
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    const id = s.addClip()
    s.addKey(id, a, 0)
    const k1 = s.addKey(id, b, 1)!
    const before = useAppStore.getState().animPast.length
    // The strip opens one stroke on pointer-down and commits on pointer-up.
    s.animBeginStroke()
    s.patchKey(id, k1, { time: 0.4 })
    s.patchKey(id, k1, { time: 0.6 })
    s.animCommitStroke()
    expect(useAppStore.getState().animPast.length).toBe(before + 1)
    expect(useAppStore.getState().clips[0].keys[1].time).toBeCloseTo(0.6, 10)
    s.animUndo()
    expect(useAppStore.getState().clips[0].keys[1].time).toBe(1)
  })

  it('tracks the editing target until reset, mode switch, delete, or new project', () => {
    addBox('arm')
    const s = useAppStore.getState()
    expect(s.editingPoseId).toBeNull()
    // Capture names the new pose as the editing target.
    s.setJointRotation('arm', [0.5, 0, 0])
    const a = s.capturePose()!
    expect(useAppStore.getState().editingPoseId).toBe(a)
    // Staging another pose and adopting it retargets the scratch to that pose.
    s.setJointRotation('arm', [0, 0.5, 0])
    const b = s.capturePose()!
    s.stagePose(a)
    s.adoptStagedPose()
    expect(useAppStore.getState().editingPoseId).toBe(a)
    // Grabbing with a pose staged retargets the same way.
    s.stagePose(b)
    s.grabPoseForEdit()
    expect(useAppStore.getState().stagedPoseId).toBeNull()
    expect(useAppStore.getState().editingPoseId).toBe(b)
    // Reset clears it; the mode switch and project load/new clear it too.
    s.resetPose()
    expect(useAppStore.getState().editingPoseId).toBeNull()
    s.setJointRotation('arm', [0.5, 0, 0])
    s.capturePose()
    expect(useAppStore.getState().editingPoseId).not.toBeNull()
    s.setAnimationMode('poses')
    s.setAnimationMode('tweens')
    expect(useAppStore.getState().editingPoseId).toBeNull()
    s.setJointRotation('arm', [0.5, 0, 0])
    const c = s.capturePose()!
    s.deletePose(c)
    expect(useAppStore.getState().editingPoseId).toBeNull()
    s.setJointRotation('arm', [0.5, 0, 0])
    s.capturePose()
    s.newProject('Fresh', 16)
    expect(useAppStore.getState().editingPoseId).toBeNull()
  })

  it('mirrorPose dedupes against the live “… mirror” name', () => {
    const [a] = twoPoses()
    const s = useAppStore.getState()
    const first = s.mirrorPose(a)!
    const second = s.mirrorPose(a)!
    const names = useAppStore.getState().poses.map((p) => p.name)
    // The second mirror uniquifies instead of colliding with the first.
    expect(names.slice(-2)).toEqual(['Pose mirror', 'Pose mirror 2'])
    expect(first).not.toBe(second)
  })

  it('adds keys at the playhead, else half a second past the last key', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    const id = s.addClip()
    // Off the timeline into an empty clip: the first key lands at 0.
    s.addKey(id, a)!
    expect(useAppStore.getState().clips[0].keys[0].time).toBe(0)
    // On the timeline: the playhead time wins.
    s.setClipTime(0.5)
    const k1 = s.addKey(id, b)!
    expect(useAppStore.getState().clips[0].keys.find((k) => k.id === k1)?.time).toBeCloseTo(0.5, 10)
    // Off the timeline again with unstaged scratch: the editing target keys past the end.
    s.stagePose(null)
    const k2 = s.addKey(id)!
    expect(useAppStore.getState().clips[0].keys.find((k) => k.id === k2)?.poseId).toBe(b)
    expect(useAppStore.getState().clips[0].keys.find((k) => k.id === k2)?.time).toBeCloseTo(1, 10)
  })
})

/** Step 4 mirror pose: the Library row button clones a pose left/right-swapped. */
describe('mirror pose', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string, name: string) {
    useAppStore.getState().addRigBox({ id, name, min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot: null, tweens: [] })
  }

  it('mirrorPose adds "<name> mirror" and undo removes it', () => {
    addBox('l', 'arm_L')
    addBox('r', 'arm_R')
    const s = useAppStore.getState()
    s.setJointRotation('l', [0.5, 0.2, 0])
    const id = s.capturePose()!
    s.renamePose(id, 'wave')
    // On the timeline (paused/scrubbed): the staged mirror must actually show.
    s.setClipTime(0.5)
    const mid = s.mirrorPose(id)
    expect(mid).toBeTruthy()
    const poses = useAppStore.getState().poses
    expect(poses.map((p) => p.name)).toEqual(['wave', 'wave mirror'])
    // Paired swap: the keyed left joint lands mirrored on the right, left stays bind.
    expect(poses[1].joints).toEqual({ r: [0.5, -0.2, 0] })
    expect(mid).toBe(poses[1].id)
    // The mirror stages for preview and steps off the timeline; scratch untouched.
    expect(useAppStore.getState().stagedPoseId).toBe(mid)
    expect(useAppStore.getState().clipTime).toBeNull()
    expect(useAppStore.getState().poseRotations.size).toBe(0)
    // Undo removes the mirrored pose but keeps the source.
    s.animUndo()
    expect(useAppStore.getState().poses.map((p) => p.name)).toEqual(['wave'])
  })

  it('mirrorPose returns null for unknown ids', () => {
    addBox('l', 'arm_L')
    expect(useAppStore.getState().mirrorPose('ghost')).toBeNull()
    expect(useAppStore.getState().poses).toHaveLength(0)
  })
})
