import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

/** The pose slice is ephemeral working state: set/collapse/reset, never undoable, never saved. */
describe('pose preview', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string, parentId: string | null = null) {
    useAppStore.getState().addRigBox({ id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId, pivot: null })
  }

  it('stores rotations per joint and drops them on reset', () => {
    addBox('arm')
    useAppStore.getState().setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.get('arm')).toEqual([0.5, 0, 0])
    useAppStore.getState().resetPose()
    expect(useAppStore.getState().poseRotations.size).toBe(0)
  })

  it('ignores unknown ids', () => {
    useAppStore.getState().setJointRotation('ghost', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(0)
  })

  it('collapses near-zero rotations back to bind', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(1)
    s.setJointRotation('arm', [1e-12, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(0)
  })

  it('clears when leaving Animate mode but survives selection changes inside it', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setMode('animate')
    s.setJointRotation('arm', [0.5, 0, 0])
    s.selectRigBox('arm')
    expect(useAppStore.getState().poseRotations.size).toBe(1)
    s.setMode('model')
    expect(useAppStore.getState().poseRotations.size).toBe(0)
  })

  it('tracks the gizmo drag latch', () => {
    expect(useAppStore.getState().poseDragging).toBe(false)
    useAppStore.getState().setPoseDragging(true)
    expect(useAppStore.getState().poseDragging).toBe(true)
    useAppStore.getState().setPoseDragging(false)
    expect(useAppStore.getState().poseDragging).toBe(false)
  })

  it('entering Pose mode lifts a hidden model view to Ghost', () => {
    const s = useAppStore.getState()
    s.setMode('animate')
    s.setAnimateModelView('hidden')
    s.setActiveTool('pose')
    // Posing an invisible model shows nothing — Ghost keeps rigs readable through it.
    expect(useAppStore.getState().animateModelView).toBe('ghost')
  })

  it('leaves other view modes alone on Pose entry', () => {
    const s = useAppStore.getState()
    s.setMode('animate')
    s.setAnimateModelView('full')
    s.setActiveTool('pose')
    expect(useAppStore.getState().animateModelView).toBe('full')
  })

  it('does not enter undo history', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setMode('animate')
    s.setJointRotation('arm', [0.5, 0, 0])
    s.animUndo()
    // The pose survives — undo only covers rig structural edits.
    expect(useAppStore.getState().poseRotations.get('arm')).toEqual([0.5, 0, 0])
  })
})
