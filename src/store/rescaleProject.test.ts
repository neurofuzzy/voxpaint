import { beforeEach, describe, expect, it } from 'vitest'
import { defaultAnimationSettings, encodeSliceKey } from '@/engine/animation/animationLayers'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { faceSizeFor } from '@/engine/texture/types'
import { useAppStore } from './useAppStore'

const SLOT: PaletteSlotRef = { kind: 'base', index: 0 }

function paintVoxel(coord: Coord, chamfer?: { shapeKind: 'ramp' | 'thin'; rotation: 0 }) {
  const s = useAppStore.getState()
  s.beginStroke()
  useAppStore.setState((state) => {
    state.model.color.set(encodeKey(...coord), { paletteSlot: SLOT })
    if (chamfer) {
      state.model.chamfer.set(encodeKey(...coord), {
        planeAxis: 'z',
        planeOrientation: 1,
        resolvedTo: { ...chamfer },
      })
    }
  })
  s.commitStroke()
}

describe('rescaleProject', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('doubles the extent and every voxel, remapping texture/markers/animation', () => {
    paintVoxel([0, 0, 0])
    paintVoxel([1, 0, 0], { shapeKind: 'ramp', rotation: 0 })
    paintVoxel([0, 1, 0], { shapeKind: 'thin', rotation: 0 })

    // Texture paint + texel selection/clipboard.
    const s0 = useAppStore.getState()
    s0.setActiveBoxFace('px')
    s0.setTextureSelection({ originU: 0, originV: 0, width: 2, height: 2, mask: new Uint8Array([1, 1, 1, 1]) })
    s0.paintTexel(0, 0)
    s0.textureCopy()
    // Voxel selection + clipboard, plane offset, marker, animation data.
    s0.setSelection({ originU: 0, originV: 0, width: 1, height: 1, mask: new Uint8Array([1]) })
    s0.copySelection()
    s0.setPlaneOffset(3)
    s0.addMarker([1, 2, 3])
    const markerId = useAppStore.getState().selectedMarkerId!
    s0.setAnimSettingsForSlice('z', 0, defaultAnimationSettings())
    useAppStore.setState((state) => {
      state.sliceMasks.set(encodeSliceKey('z', 0), new Set([encodeKey(0, 0, 0)]))
      state.slicePivots.set(encodeSliceKey('z', 0), encodeKey(0, 0, 0))
    })
    expect(useAppStore.getState().past.length).toBeGreaterThan(0)
    expect(useAppStore.getState().animPast.length).toBeGreaterThan(0)

    useAppStore.getState().rescaleProject()
    const after = useAppStore.getState()

    // Extent doubled, voxels octuplicated (cube 8 + ramp 6 + thin 8).
    expect(after.meta.gridExtent).toBe(32)
    expect(after.model.color.size).toBe(8 + 6 + 8)
    expect(after.dirty).toBe(true)
    // Thin slab became halves.
    expect(after.model.chamfer.get(encodeKey(0, 2, 0))?.resolvedTo).toEqual({ shapeKind: 'half', rotation: 0 })

    // Texture face doubled with duplicated texels (active face after paintTexel(0,0)... may be
    // null-face; assert via the painted content instead: find any painted texel).
    expect(faceSizeFor(after.meta.gridExtent)).toBe(2 * faceSizeFor(16))
    let painted = 0
    for (const face of ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const) {
      for (const t of after.texture.faces[face]) if (t !== 255) painted++
    }
    expect(painted).toBeGreaterThan(0)

    // Marker doubled, still selected.
    expect(after.markers).toHaveLength(1)
    expect(after.markers[0].position).toEqual([2, 4, 6])
    expect(after.selectedMarkerId).toBe(markerId)

    // Animation fanned out to both new slices; mask cells expanded; pivot min-cornered.
    expect(after.animSettings.has(encodeSliceKey('z', 0))).toBe(true)
    expect(after.animSettings.has(encodeSliceKey('z', 1))).toBe(true)
    expect(after.animSettings.get(encodeSliceKey('z', 0))).toEqual(after.animSettings.get(encodeSliceKey('z', 1)))
    expect(after.animSettings.get(encodeSliceKey('z', 0))).not.toBe(after.animSettings.get(encodeSliceKey('z', 1)))
    expect(after.sliceMasks.get(encodeSliceKey('z', 0))?.size).toBe(4)
    expect(after.sliceMasks.get(encodeSliceKey('z', 1))?.size).toBe(4)
    expect(after.slicePivots.get(encodeSliceKey('z', 0))).toBe(encodeKey(0, 0, 0))
    expect(after.slicePivots.get(encodeSliceKey('z', 1))).toBe(encodeKey(0, 0, 0))

    // Histories cleared (not undoable), selections/floats dropped, clipboard kept, plane doubled.
    expect(after.past).toEqual([])
    expect(after.future).toEqual([])
    expect(after.texturePast).toEqual([])
    expect(after.animPast).toEqual([])
    expect(after.selection).toBeNull()
    expect(after.floatContent).toBeNull()
    expect(after.textureSelection).toBeNull()
    expect(after.clipboard).not.toBeNull()
    expect(after.textureClipboard).not.toBeNull()
    expect(after.plane.offset).toBe(6)
  })

  it('no-ops past the 64-cell cap', () => {
    useAppStore.getState().newProject('Big', 48)
    paintVoxel([0, 0, 0])
    const before = useAppStore.getState()

    useAppStore.getState().rescaleProject()

    const after = useAppStore.getState()
    expect(after.meta.gridExtent).toBe(48)
    expect(after.model.color.size).toBe(before.model.color.size)
  })

  it('handles an empty model (extent still doubles)', () => {
    useAppStore.getState().rescaleProject()
    const after = useAppStore.getState()
    expect(after.meta.gridExtent).toBe(32)
    expect(after.model.color.size).toBe(0)
    expect(after.model.bounds).toBeNull()
  })
})
