import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

describe('setSlotMaterial', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('assigns and clears a material on a slot, dirtying the project', () => {
    expect(useAppStore.getState().slotMaterials).toEqual({})
    useAppStore.getState().setSlotMaterial('base:0', 'cast-iron')
    expect(useAppStore.getState().slotMaterials).toEqual({ 'base:0': 'cast-iron' })
    expect(useAppStore.getState().dirty).toBe(true)
    useAppStore.getState().setSlotMaterial('base:0', null)
    expect(useAppStore.getState().slotMaterials).toEqual({})
  })

  it('resets assignments on new project', () => {
    useAppStore.getState().setSlotMaterial('metal:1', 'copper-brushed')
    useAppStore.getState().newProject('Fresh', 16)
    expect(useAppStore.getState().slotMaterials).toEqual({})
  })
})
