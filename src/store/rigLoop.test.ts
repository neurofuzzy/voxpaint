import { beforeEach, describe, expect, it } from 'vitest'
import type { RigLoop } from '@/engine/rigging/types'
import { useAppStore } from './useAppStore'

/** Rig loops: per-box procedural motion, undoable, mutually exclusive with posing. */
describe('rig loops', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string, parentId: string | null = null) {
    useAppStore.getState().addRigBox({ id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId, pivot: null, loop: null })
  }

  const spin: RigLoop = { kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4 }

  it('sets and clears a loop on the animate undo stack', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setRigLoop('arm', spin)
    expect(useAppStore.getState().rigBoxes.find((b) => b.id === 'arm')?.loop).toEqual(spin)
    s.animUndo()
    expect(useAppStore.getState().rigBoxes.find((b) => b.id === 'arm')?.loop ?? null).toBeNull()
    s.animRedo()
    expect(useAppStore.getState().rigBoxes.find((b) => b.id === 'arm')?.loop).toEqual(spin)
  })

  it('setting a loop clears that joint pose; posing a looped joint is refused', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(1)
    s.setRigLoop('arm', spin)
    expect(useAppStore.getState().poseRotations.size).toBe(0)
    s.setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(0)
    // Clearing the loop re-enables posing.
    s.setRigLoop('arm', null)
    s.setJointRotation('arm', [0.5, 0, 0])
    expect(useAppStore.getState().poseRotations.size).toBe(1)
  })

  it('ignores unknown ids', () => {
    useAppStore.getState().setRigLoop('ghost', spin)
    expect(useAppStore.getState().rigBoxes).toHaveLength(0)
  })
})
