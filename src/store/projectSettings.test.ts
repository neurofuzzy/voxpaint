import { beforeEach, describe, expect, it } from 'vitest'
import { defaultAnimationSettings, encodeSliceKey } from '@/engine/animation/animationLayers'
import { encodeKey } from '@/engine/grid/GridStore'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { Coord } from '@/engine/grid/types'
import type { BoxFace } from '@/engine/texture/types'
import { cloneTextureModel, texelIndex } from '@/engine/texture/TextureStore'
import { EMPTY, faceSizeFor } from '@/engine/texture/types'
import { useAppStore } from './useAppStore'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }

function paintVoxels(...coords: Coord[]) {
  const s = useAppStore.getState()
  s.beginStroke()
  useAppStore.setState((state) => {
    for (const coord of coords) state.model.color.set(encodeKey(...coord), { paletteSlot: base0 })
  })
  s.commitStroke()
}

function paintTexels(face: BoxFace, ...writes: Array<readonly [number, number, number]>) {
  const s = useAppStore.getState()
  s.textureBeginStroke()
  const next = cloneTextureModel(s.texture)
  const faceSize = faceSizeFor(s.meta.gridExtent)
  for (const [tu, tv, value] of writes) next.faces[face][texelIndex(tu, tv, faceSize)] = value
  s.setTexture(next)
  s.textureCommitStroke()
}

describe('updateProjectSettings', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('rename-only keeps the model, size, and history', () => {
    paintVoxels([0, 0, 0])
    expect(useAppStore.getState().past.length).toBe(1)

    useAppStore.getState().updateProjectSettings('Renamed', 16)

    const after = useAppStore.getState()
    expect(after.meta.name).toBe('Renamed')
    expect(after.meta.gridExtent).toBe(16)
    expect(after.model.color.size).toBe(1)
    expect(after.past.length).toBe(1)
  })

  it('growing keeps voxels, center-pads the texture, and clears history', () => {
    paintVoxels([0, 0, 0])
    paintTexels('px', [0, 0, 3])
    expect(useAppStore.getState().past.length).toBe(1)
    expect(useAppStore.getState().texturePast.length).toBe(1)

    useAppStore.getState().updateProjectSettings('Test', 24)

    const after = useAppStore.getState()
    expect(after.meta.gridExtent).toBe(24)
    expect(after.model.color.size).toBe(1)
    // 16→24 shifts texels by (12-8)*4 = +16 per axis.
    expect(after.texture.faces.px.length).toBe(faceSizeFor(24) ** 2)
    expect(after.texture.faces.px[texelIndex(16, 16, faceSizeFor(24))]).toBe(3)
    expect(after.texture.faces.px[texelIndex(0, 0, faceSizeFor(24))]).toBe(EMPTY)
    expect(after.past).toEqual([])
    expect(after.texturePast).toEqual([])
  })

  it('shrinking clips out-of-bounds voxels, crops the texture, and resets position state', () => {
    paintVoxels([0, 0, 0], [7, 7, 7]) // (7,7,7) is outside the 8-cube ([-4,4))
    paintTexels('px', [32, 32, 5]) // face centre at 16³ (64² faces)
    const s = useAppStore.getState()
    s.setPlaneOffset(7)
    s.setAnimSettingsForSlice('z', 7, defaultAnimationSettings())
    s.setAnimSettingsForSlice('z', 0, defaultAnimationSettings())

    useAppStore.getState().updateProjectSettings('Test', 8)

    const after = useAppStore.getState()
    expect(after.meta.gridExtent).toBe(8)
    expect(after.model.color.size).toBe(1)
    expect([...after.model.color.keys()]).toEqual([encodeKey(0, 0, 0)])
    expect(after.model.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
    // 16→8 shifts texels by (4-8)*4 = -16: old centre (32,32) lands on new (16,16).
    expect(after.texture.faces.px.length).toBe(faceSizeFor(8) ** 2)
    expect(after.texture.faces.px[texelIndex(16, 16, faceSizeFor(8))]).toBe(5)
    expect(after.past).toEqual([])
    expect(after.texturePast).toEqual([])
    expect(after.plane.offset).toBe(3) // clamped into [-4,4)
    expect(after.animSettings.has(encodeSliceKey('z', 7))).toBe(false)
    expect(after.animSettings.has(encodeSliceKey('z', 0))).toBe(true)
    expect(after.dirty).toBe(true)
  })

  it('newProject still starts blank at any size (regression guard for the shared picker refactor)', () => {
    useAppStore.getState().newProject('Blank', 8)
    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(0)
    expect(after.texture.faces.px.length).toBe(faceSizeFor(8) ** 2)
  })
})
