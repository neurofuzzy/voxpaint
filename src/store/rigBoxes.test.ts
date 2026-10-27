import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { useAppStore } from './useAppStore'

const SLOT: PaletteSlotRef = { kind: 'base', index: 0 }

function paintVoxels(...coords: Array<[number, number, number]>) {
  const s = useAppStore.getState()
  s.beginStroke()
  useAppStore.setState((state) => {
    for (const coord of coords) {
      state.model.color.set(encodeKey(...coord), { paletteSlot: SLOT })
    }
  })
  s.commitStroke()
}

describe('rig box duplicates', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('re-tapping the same region selects the existing box instead of duplicating', () => {
    paintVoxels([0, 0, 0], [1, 0, 0])
    useAppStore.getState().applyRigBoxAt([0, 0, 0])
    const first = useAppStore.getState().selectedRigBoxId!
    expect(useAppStore.getState().rigBoxes).toHaveLength(1)
    // Different voxel, same color-connected region (same flood bounds).
    useAppStore.getState().applyRigBoxAt([1, 0, 0])
    expect(useAppStore.getState().rigBoxes).toHaveLength(1)
    expect(useAppStore.getState().selectedRigBoxId).toBe(first)
  })

  it('still boxes genuinely new regions', () => {
    paintVoxels([0, 0, 0], [1, 0, 0], [4, 0, 0])
    useAppStore.getState().applyRigBoxAt([0, 0, 0])
    useAppStore.getState().applyRigBoxAt([4, 0, 0])
    expect(useAppStore.getState().rigBoxes).toHaveLength(2)
  })
})
