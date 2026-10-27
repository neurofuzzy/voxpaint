import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

/** Store-level coverage for rig pivots: selection gating and fractional boundaries. */
describe('rig pivots', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string, min: [number, number, number], max: [number, number, number]) {
    useAppStore.getState().addRigBox({ id, name: id, min, max, parentId: null, pivot: null })
  }

  const pivotOf = (id: string) => useAppStore.getState().rigBoxes.find((b) => b.id === id)?.pivot

  it('setSelectedRigPivot returns false with nothing selected (toast is a headless no-op)', () => {
    expect(useAppStore.getState().setSelectedRigPivot([0, 0, 0])).toBe(false)
  })

  it('setRigPivot accepts fractional boundary pivots directly', () => {
    addBox('arm', [0, 0, 0], [2, 2, 2])
    useAppStore.getState().setRigPivot('arm', [2.5, 1, 1])
    expect(pivotOf('arm')).toEqual([2.5, 1, 1])
  })
})
