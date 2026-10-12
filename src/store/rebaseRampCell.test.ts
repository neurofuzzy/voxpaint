import { beforeEach, describe, expect, it } from 'vitest'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { useAppStore } from './useAppStore'

/** Seeds a single ramp authored on (x,+1) rot0 — the handed dual of (z,-1) rot0. */
function seedRampModel(): VoxelModel {
  const model = emptyModel()
  const key = encodeKey(0, 0, 0)
  model.color.set(key, { paletteSlot: { kind: 'base', index: 3 } })
  model.chamfer.set(key, {
    planeAxis: 'x',
    planeOrientation: 1,
    resolvedTo: { shapeKind: 'ramp', rotation: 0 },
  })
  return model
}

/** Drives the real store to verify the texture-face rebase: rewrites the chamfer basis onto the
 * active plane (switching its box-mapped face) while leaving color and shapeKind untouched, and
 * silently no-ops on everything else. */
describe('rebaseRampCell', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setModel(seedRampModel())
    // Active plane: the dual basis (z,-1) at the cell's own slice.
    useAppStore.getState().setPlaneAxisOrientation('z', -1)
    useAppStore.getState().setPlaneOffset(0)
  })

  it('rebases the ramp onto the active plane, preserving color and shape', () => {
    const s = useAppStore.getState()
    const { u, v } = pixelFromGridCoord(s.plane, [0, 0, 0])
    s.beginStroke()
    const changed = s.rebaseRampCell(u, v)
    s.commitStroke()

    expect(changed).toBe(true)
    const after = useAppStore.getState()
    const cell = after.model.chamfer.get(encodeKey(0, 0, 0))!
    expect(cell.planeAxis).toBe('z')
    expect(cell.planeOrientation).toBe(-1)
    expect(cell.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 0 })
    expect(after.model.color.get(encodeKey(0, 0, 0))).toEqual({ paletteSlot: { kind: 'base', index: 3 } })
  })

  it('is idempotent: a second stroke on the same basis reports no change', () => {
    const s = useAppStore.getState()
    const { u, v } = pixelFromGridCoord(s.plane, [0, 0, 0])
    s.beginStroke()
    expect(s.rebaseRampCell(u, v)).toBe(true)
    s.commitStroke()

    s.beginStroke()
    expect(s.rebaseRampCell(u, v)).toBe(false)
    s.commitStroke()
  })

  it('no-ops on empty cells, plain cubes, and non-prism chamfers', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    // Empty cell far from the seeded ramp.
    expect(s.rebaseRampCell(5, 5)).toBe(false)

    // Plain cube (color only).
    const cube = emptyModel()
    cube.color.set(encodeKey(1, 0, 0), { paletteSlot: { kind: 'base', index: 0 } })
    useAppStore.getState().setModel(cube)
    const { u, v } = pixelFromGridCoord(useAppStore.getState().plane, [1, 0, 0])
    expect(s.rebaseRampCell(u, v)).toBe(false)

    // Convex chamfer (not a prism congruent to a ramp — never convertible).
    const convex = emptyModel()
    convex.color.set(encodeKey(2, 0, 0), { paletteSlot: { kind: 'base', index: 0 } })
    convex.chamfer.set(encodeKey(2, 0, 0), {
      planeAxis: 'y',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'convex', rotation: 0 },
    })
    useAppStore.getState().setModel(convex)
    const c2 = pixelFromGridCoord(useAppStore.getState().plane, [2, 0, 0])
    expect(s.rebaseRampCell(c2.u, c2.v)).toBe(false)
    s.commitStroke()
  })

  it('converts a wedge to its congruent ramp on the active plane, preserving color', () => {
    const wedge = emptyModel()
    wedge.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })
    wedge.chamfer.set(encodeKey(0, 0, 0), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'wedge', rotation: 3 },
    })
    useAppStore.getState().setModel(wedge)
    // Active plane from beforeEach is (z,-1)... switch to the top basis, the wedge's dual side.
    useAppStore.getState().setPlaneAxisOrientation('y', 1)
    const s = useAppStore.getState()
    const { u, v } = pixelFromGridCoord(s.plane, [0, 0, 0])
    s.beginStroke()
    const changed = s.rebaseRampCell(u, v)
    s.commitStroke()

    expect(changed).toBe(true)
    const after = useAppStore.getState()
    const cell = after.model.chamfer.get(encodeKey(0, 0, 0))!
    expect(cell.planeAxis).toBe('y')
    expect(cell.planeOrientation).toBe(1)
    expect(cell.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 2 })
    expect(after.model.color.get(encodeKey(0, 0, 0))).toEqual({ paletteSlot: { kind: 'base', index: 3 } })

    // Second stroke is idempotent (now a ramp already on this basis).
    s.beginStroke()
    expect(s.rebaseRampCell(u, v)).toBe(false)
    s.commitStroke()
  })

  it('flips a thin slab on its own axis, preserving the solid and color', () => {
    const thin = emptyModel()
    thin.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })
    thin.chamfer.set(encodeKey(0, 0, 0), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'thin', rotation: 0 },
    })
    useAppStore.getState().setModel(thin)
    // Active plane from beforeEach is (z,-1), the slab's own axis flipped.
    const s = useAppStore.getState()
    const { u, v } = pixelFromGridCoord(s.plane, [0, 0, 0])
    s.beginStroke()
    expect(s.rebaseRampCell(u, v)).toBe(true)
    s.commitStroke()

    const after = useAppStore.getState()
    const cell = after.model.chamfer.get(encodeKey(0, 0, 0))!
    expect(cell.planeAxis).toBe('z')
    expect(cell.planeOrientation).toBe(-1)
    expect(cell.resolvedTo).toEqual({ shapeKind: 'thin', rotation: 0 })
    expect(after.model.color.get(encodeKey(0, 0, 0))).toEqual({ paletteSlot: { kind: 'base', index: 3 } })

    // Idempotent once flipped.
    s.beginStroke()
    expect(s.rebaseRampCell(u, v)).toBe(false)
    s.commitStroke()
  })

  it('refuses a cross-axis thin facing (that would rotate the slab)', () => {
    const thin = emptyModel()
    thin.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })
    thin.chamfer.set(encodeKey(0, 0, 0), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'thin', rotation: 0 },
    })
    useAppStore.getState().setModel(thin)
    useAppStore.getState().setPlaneAxisOrientation('x', 1)
    const s = useAppStore.getState()
    const { u, v } = pixelFromGridCoord(s.plane, [0, 0, 0])
    s.beginStroke()
    expect(s.rebaseRampCell(u, v)).toBe(false)
    s.commitStroke()

    expect(useAppStore.getState().model.chamfer.get(encodeKey(0, 0, 0))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'thin', rotation: 0 },
    })
  })
})
