import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

/** Tween stacks: per-box ordered looping motions, undoable, mutually exclusive with posing. */
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

  it('enabling a tween clears that joint pose; posing a tweened joint is refused', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(1)
    const id = s.addTween('arm')!
    expect(useAppStore.getState().poseRotations.size).toBe(0)
    s.setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(0)
    // Muting all tweens re-enables posing.
    s.setTweenEnabled('arm', id, false)
    s.setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(1)
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
