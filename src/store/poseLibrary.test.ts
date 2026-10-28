import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

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

describe('pose cycles', () => {
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

  it('sets a cycle definition on the undo stack and plays/stops transport', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    s.setPoseCycle({ fromId: a, toId: b, mode: 'pingpong', speed: 1 })
    expect(useAppStore.getState().poseCycle?.mode).toBe('pingpong')
    s.setCyclePlaying(true)
    expect(useAppStore.getState().cyclePlaying).toBe(true)
    s.setCyclePlaying(false)
    expect(useAppStore.getState().cyclePlaying).toBe(false)
    // Definition undoes; transport never enters history.
    s.setCyclePlaying(true)
    s.animUndo()
    expect(useAppStore.getState().poseCycle).toBeNull()
    expect(useAppStore.getState().cyclePlaying).toBe(true)
  })

  it('deleting a referenced pose clears the cycle', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    s.setPoseCycle({ fromId: a, toId: b, mode: 'loop', speed: 2 })
    s.setCyclePlaying(true)
    s.deletePose(a)
    expect(useAppStore.getState().poseCycle).toBeNull()
    expect(useAppStore.getState().cyclePlaying).toBe(false)
  })

  it('grabbing for edit freezes the preview into the scratch and stops transport', () => {
    const [a, b] = twoPoses()
    const s = useAppStore.getState()
    // Stage + grab: scratch takes the staged joints, staging clears.
    s.stagePose(a)
    s.grabPoseForEdit()
    expect(useAppStore.getState().poseRotations.get('arm')).toEqual([0.5, 0, 0])
    expect(useAppStore.getState().stagedPoseId).toBeNull()
    // Cycle + grab: scratch takes the in-flight frame, transport stops.
    s.setPoseCycle({ fromId: a, toId: b, mode: 'pingpong', speed: 1 })
    s.setCyclePlaying(true)
    s.grabPoseForEdit()
    expect(useAppStore.getState().cyclePlaying).toBe(false)
    expect(useAppStore.getState().poseRotations.has('arm')).toBe(true)
  })
})
