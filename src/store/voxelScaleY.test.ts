import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { useAppStore } from './useAppStore'
import type { AppState } from './types'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
type VoxelScaleY = 0.5 | 1 | 2
/** `meta` once it carries the Y voxel scale. */
type MetaWithScale = AppState['meta'] & { voxelScaleY?: VoxelScaleY }
/** Store once it exposes the scale setter. */
type StoreWithScale = AppState & { setVoxelScaleY?: (k: VoxelScaleY) => void }

function scaleOf(): VoxelScaleY | undefined {
  return (useAppStore.getState().meta as MetaWithScale).voxelScaleY
}

describe('voxelScaleY setting', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('new projects default to 1x', () => {
    expect(scaleOf()).toBe(1)
  })

  it('exposes a setter that preserves model, size, texture, and history', () => {
    const s = useAppStore.getState() as StoreWithScale
    expect(typeof s.setVoxelScaleY).toBe('function')
    s.beginStroke()
    useAppStore.setState((st) => {
      st.model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    })
    s.commitStroke()
    const textureBefore = useAppStore.getState().texture

    s.setVoxelScaleY!(0.5)

    const after = useAppStore.getState()
    expect(scaleOf()).toBe(0.5)
    expect(after.model.color.size).toBe(1)
    expect(after.meta.gridExtent).toBe(16)
    expect(after.texture).toBe(textureBefore)
    expect(after.past.length).toBe(1)
  })
})
