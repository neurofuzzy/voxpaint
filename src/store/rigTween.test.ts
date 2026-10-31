import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

/** Tween stacks: per-box ordered looping motions, undoable, gated by project animation mode. */
describe('rig tweens', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string) {
    useAppStore.getState().addRigBox({ id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot: null, tweens: [] })
  }

  function tweensOf(id: string) {
    return useAppStore.getState().rigBoxes.find((b) => b.id === id)?.tweens ?? []
  }

  it('adds, patches, reorders, mutes, and removes tweens on the animate undo stack', () => {
    addBox('arm')
    const s = useAppStore.getState()
    const first = s.addTween('arm')!
    const second = s.addTween('arm')!
    expect(tweensOf('arm')).toHaveLength(2)
    // Patch params.
    s.patchTween('arm', first, { kind: 'slide', axis: 'x', amount: 5 })
    expect(tweensOf('arm')[0]).toMatchObject({ kind: 'slide', axis: 'x', amount: 5 })
    // Reorder: second moves first.
    s.moveTween('arm', second, -1)
    expect(tweensOf('arm').map((t) => t.id)).toEqual([second, first])
    // Mute keeps params.
    s.setTweenEnabled('arm', second, false)
    expect(tweensOf('arm')[0]).toMatchObject({ enabled: false, kind: 'rotate' })
    // Remove.
    s.removeTween('arm', second)
    expect(tweensOf('arm').map((t) => t.id)).toEqual([first])
    // Whole sequence (add/add/patch/move/mute/remove = 6 strokes) undoes back to empty.
    for (let i = 0; i < 6; i++) useAppStore.getState().animUndo()
    expect(tweensOf('arm')).toHaveLength(0)
  })

  it('coalesces a slider drag into a single undo entry', () => {
    addBox('arm')
    const s = useAppStore.getState()
    const id = s.addTween('arm')!
    s.patchTween('arm', id, { kind: 'slide' })
    // Simulated drag: one external stroke around N updates.
    s.animBeginStroke()
    s.patchTween('arm', id, { amount: 2 })
    s.patchTween('arm', id, { amount: 4 })
    s.patchTween('arm', id, { amount: 6 })
    s.animCommitStroke()
    expect(tweensOf('arm')[0].amount).toBe(6)
    s.animUndo()
    // One undo returns to the pre-drag value (2 tweens… actually the kind patch), not stepwise.
    expect(tweensOf('arm')[0].amount).toBe(4)
  })

  it('gates by project animation mode: tweens evaluate in tweens mode, poses in poses mode', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(1)
    // Enabling a tween no longer clears the pose — the mode switch mutes it instead.
    const id = s.addTween('arm')!
    expect(useAppStore.getState().poseRotations.size).toBe(1)
    expect(useAppStore.getState().meta.animationMode).toBe('tweens')
    // Switching to poses keeps the tween (muted) and clears the scratch.
    s.setAnimationMode('poses')
    expect(useAppStore.getState().poseRotations.size).toBe(0)
    expect(tweensOf('arm')).toHaveLength(1)
    // Switching back loses nothing.
    s.setAnimationMode('tweens')
    expect(tweensOf('arm').map((t) => t.id)).toEqual([id])
    expect(useAppStore.getState().meta.animationMode).toBe('tweens')
    // The mode switch itself never enters undo history (like setVoxelScaleY).
    const depth = useAppStore.getState().animPast.length
    s.setAnimationMode('poses')
    expect(useAppStore.getState().animPast.length).toBe(depth)
    expect(useAppStore.getState().meta.animationMode).toBe('poses')
  })

  it('patches pendulum endpoints on the animate undo stack', () => {
    addBox('arm')
    const s = useAppStore.getState()
    const id = s.addTween('arm')!
    s.patchTween('arm', id, { kind: 'pendulum', minAngle: -45, maxAngle: 60 })
    expect(tweensOf('arm')[0]).toMatchObject({ kind: 'pendulum', minAngle: -45, maxAngle: 60 })
    useAppStore.getState().animUndo()
    expect(tweensOf('arm')[0]).toMatchObject({ kind: 'rotate', minAngle: -30, maxAngle: 30 })
  })

  it('duplicates a tween with a fresh id right after the original', () => {
    addBox('arm')
    const s = useAppStore.getState()
    const id = s.addTween('arm')!
    s.patchTween('arm', id, { kind: 'pendulum', minAngle: -45, maxAngle: 60 })
    const dupe = s.duplicateTween('arm', id)!
    expect(dupe).not.toBe(id)
    const tweens = tweensOf('arm')
    expect(tweens.map((t) => t.id)).toEqual([id, dupe])
    expect(tweens[1]).toMatchObject({ kind: 'pendulum', minAngle: -45, maxAngle: 60, enabled: true })
    // One undo removes the copy, leaving the original.
    useAppStore.getState().animUndo()
    expect(tweensOf('arm').map((t) => t.id)).toEqual([id])
    expect(s.duplicateTween('arm', 'ghost')).toBeNull()
    expect(s.duplicateTween('ghost', id)).toBeNull()
  })

  it('moves tweens across boxes at a drop index and selects the destination', () => {
    addBox('arm')
    addBox('leg')
    const s = useAppStore.getState()
    const a1 = s.addTween('arm')!
    const a2 = s.addTween('arm')!
    const l1 = s.addTween('leg')!
    // Drop between arm's rows = index 1.
    s.moveTweenToBox('arm', a2, 'leg', 1)
    expect(tweensOf('arm').map((t) => t.id)).toEqual([a1])
    expect(tweensOf('leg').map((t) => t.id)).toEqual([l1, a2])
    // The destination box is selected (new tweens land there next).
    expect(useAppStore.getState().selectedRigBoxId).toBe('leg')
    // Same-box move reorders with pre-removal indexing: moving l1 to slot 2 of
    // [l1, a2] lands it last.
    s.moveTweenToBox('leg', l1, 'leg', 2)
    expect(tweensOf('leg').map((t) => t.id)).toEqual([a2, l1])
    // Omitted index appends; unknown ids no-op.
    s.moveTweenToBox('arm', a1, 'leg')
    expect(tweensOf('arm')).toHaveLength(0)
    expect(tweensOf('leg').map((t) => t.id)).toEqual([a2, l1, a1])
    s.moveTweenToBox('ghost', a1, 'leg')
    s.moveTweenToBox('leg', 'ghost', 'arm')
    s.moveTweenToBox('leg', a1, 'ghost')
    expect(tweensOf('leg')).toHaveLength(3)
    // Whole sequence undoes back to empty stacks.
    for (let i = 0; i < 6; i++) useAppStore.getState().animUndo()
    expect(tweensOf('arm')).toHaveLength(0)
    expect(tweensOf('leg')).toHaveLength(0)
  })

  it('ignores unknown ids', () => {
    const s = useAppStore.getState()
    expect(s.addTween('ghost')).toBeNull()
    s.removeTween('ghost', 'tw-x')
    s.moveTween('ghost', 'tw-x', 1)
    s.setTweenEnabled('ghost', 'tw-x', false)
    s.patchTween('ghost', 'tw-x', { amount: 3 })
    expect(useAppStore.getState().rigBoxes).toHaveLength(0)
  })
})
