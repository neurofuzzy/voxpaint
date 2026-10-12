import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { rectRegion } from '@/engine/tools/selectionMask'
import { useAppStore } from './useAppStore'

const PLANE = { axis: 'z' as const, orientation: 1 as const, offset: 0 }
const keyFor = (u: number, v: number) => encodeKey(...gridCoordFromPixel(PLANE, u, v))
const SLOT_A = { kind: 'base', index: 0 } as const
const SLOT_B = { kind: 'base', index: 1 } as const

describe('floodFill (2D, edge-leak guard)', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('fills an enclosed empty pocket normally', () => {
    // Ring of SLOT_B around (0,0) on a 16x16 plane (span -8..7) — an enclosed pocket, doesn't
    // reach any edge.
    const s = useAppStore.getState()
    s.setActivePaletteSlot(SLOT_B)
    s.beginStroke()
    for (const [u, v] of [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ] as const) {
      s.paintCell(u, v)
    }
    s.commitStroke()

    s.setActivePaletteSlot(SLOT_A)
    s.floodFill(0, 0)

    expect(useAppStore.getState().model.color.get(keyFor(0, 0))?.paletteSlot).toEqual(SLOT_A)
  })

  it('rejects a fill that leaks across all 4 edges of the plane instead of painting the whole plane', () => {
    const s = useAppStore.getState()
    const before = s.model.color.size
    // Empty 16x16 plane: flood fill from the middle reaches every edge -> rejected outright.
    s.floodFill(0, 0)

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(before)
    expect(after.past.length).toBe(0) // no undo stroke was even opened
  })

  it('fills an empty selection without needing painted bounds', () => {
    const s = useAppStore.getState()
    s.setActivePaletteSlot(SLOT_A)
    // 4x4 selection on a completely empty plane — the old leak guard would reject this.
    s.setSelection(rectRegion(-2, -2, 1, 1))
    s.floodFill(0, 0)

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(16)
    expect(after.model.color.get(keyFor(1, 1))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.has(keyFor(2, 2))).toBe(false) // outside the selection
    expect(after.past.length).toBe(1)
  })

  it('still leak-guards a click outside the selection', () => {
    const s = useAppStore.getState()
    s.setSelection(rectRegion(0, 0, 2, 2))
    s.floodFill(5, 5) // outside the selection, empty plane -> would repaint everything

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(0)
    expect(after.past.length).toBe(0)
  })
})

describe('floodFill3D (alt-click, 3D connected fill)', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('no-ops when the clicked cell has no voxel', () => {
    const s = useAppStore.getState()
    const before = s.model.color.size
    s.floodFill3D(0, 0)
    expect(useAppStore.getState().model.color.size).toBe(before)
    expect(useAppStore.getState().past.length).toBe(0)
  })

  it('recolors a 3D-connected blob of matching voxels across multiple planes', () => {
    const s = useAppStore.getState()
    s.setActivePaletteSlot(SLOT_A)
    s.beginStroke()
    s.paintCell(0, 0)
    s.commitStroke()
    // Stack a second voxel directly above it along z via a different plane offset.
    s.setPlaneOffset(1)
    s.beginStroke()
    s.paintCell(0, 0)
    s.commitStroke()
    const keyAtOffset1 = encodeKey(...gridCoordFromPixel(useAppStore.getState().plane, 0, 0))
    s.setPlaneOffset(0)

    s.setActivePaletteSlot(SLOT_B)
    s.floodFill3D(0, 0)

    const after = useAppStore.getState()
    expect(after.model.color.get(keyFor(0, 0))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.get(keyAtOffset1)?.paletteSlot).toEqual(SLOT_B)
  })

  it('does not spread across voxels of a different color', () => {
    const s = useAppStore.getState()
    s.setActivePaletteSlot(SLOT_A)
    s.beginStroke()
    s.paintCell(0, 0)
    s.commitStroke()
    s.setActivePaletteSlot(SLOT_B)
    s.beginStroke()
    s.paintCell(1, 0)
    s.commitStroke()

    s.setActivePaletteSlot(SLOT_A)
    s.floodFill3D(0, 0)

    const after = useAppStore.getState()
    expect(after.model.color.get(keyFor(0, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(keyFor(1, 0))?.paletteSlot).toEqual(SLOT_B) // untouched
  })
})

describe('liftSelectionToFloat (deep alt-drag)', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  /** (u,v) = (0,0) on z/1/offset-0 is [0,-1,0]; depth +1 is [0,-1,1]. */
  function paintColumn() {
    useAppStore.setState((s) => {
      s.model.color.set(encodeKey(0, -1, 0), { paletteSlot: SLOT_A })
      s.model.color.set(encodeKey(0, -1, 1), { paletteSlot: SLOT_B })
    })
  }

  it('alt lift grabs the full cuboid and bakes it back shifted with depths intact', () => {
    paintColumn()
    useAppStore.getState().setSelection({ originU: 0, originV: 0, width: 1, height: 1, mask: new Uint8Array([1]) })
    useAppStore.getState().liftSelectionToFloat(true)

    const lifted = useAppStore.getState()
    expect(lifted.floatContent!.cells.length).toBe(16) // every depth of the 16-cube
    expect(lifted.model.color.size).toBe(0) // whole cuboid cleared from the model

    lifted.moveFloatTo(2, 0)
    lifted.bakeFloatIfAny()

    const after = useAppStore.getState()
    expect(after.model.color.get(encodeKey(2, -1, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(encodeKey(2, -1, 1))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.size).toBe(2)
    expect(after.floatContent).toBeNull()
  })

  it('bake replaces: empty float cells clear the destination', () => {
    paintColumn()
    // 2-wide region: (0,0) occupied, (1,0) empty. Destination [3,-1,0] starts occupied.
    useAppStore.setState((s) => {
      s.model.color.set(encodeKey(3, -1, 0), { paletteSlot: SLOT_B })
    })
    useAppStore.getState().setSelection({ originU: 0, originV: 0, width: 2, height: 1, mask: new Uint8Array([1, 1]) })
    useAppStore.getState().liftSelectionToFloat()
    useAppStore.getState().moveFloatTo(2, 0)
    useAppStore.getState().bakeFloatIfAny()

    const after = useAppStore.getState()
    expect(after.model.color.get(encodeKey(2, -1, 0))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.has(encodeKey(3, -1, 0))).toBe(false) // cleared by the empty cell
  })
})

describe('faceSelection', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('re-faces a thin slab onto the flipped plane orientation and ignores cubes', () => {
    const s = useAppStore.getState()
    s.setActivePaletteSlot(SLOT_A)
    // Thin slab authored on the default z/1 plane, plus a plain cube beside it (same slice).
    s.setActiveVoxelKind('thin')
    s.beginStroke()
    s.paintCell(0, 0)
    s.commitStroke()
    s.setActiveVoxelKind('cube')
    s.beginStroke()
    s.paintCell(1, 0)
    s.commitStroke()

    const thinBefore = useAppStore.getState().model.chamfer.get(keyFor(0, 0))!
    expect(thinBefore.planeAxis).toBe('z')

    // Flip the plane to face the other way: the slab flips orientation (identical solid, new
    // texture face), the cube is untouched.
    useAppStore.getState().setPlaneAxisOrientation('z', -1)
    useAppStore.getState().setSelection(rectRegion(0, 0, 1, 0))
    const result = useAppStore.getState().faceSelection()
    expect(result).toEqual({ faced: 1, skipped: 0 })

    const after = useAppStore.getState()
    const thin = after.model.chamfer.get(keyFor(0, 0))!
    expect(thin.planeAxis).toBe('z')
    expect(thin.planeOrientation).toBe(-1)
    expect(thin.resolvedTo).toEqual({ shapeKind: 'thin', rotation: 0 })
    expect(after.model.chamfer.has(keyFor(1, 0))).toBe(false) // cube gained no basis
    expect(after.model.color.get(keyFor(1, 0))?.paletteSlot).toEqual(SLOT_A)

    // Undo restores the original basis.
    after.undo()
    expect(useAppStore.getState().model.chamfer.get(keyFor(0, 0))?.planeOrientation).toBe(1)
  })

  it('only affects the selected slice and refuses geometry edits', () => {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('thin')
    s.beginStroke()
    s.paintCell(0, 0)
    s.commitStroke()

    // Cross-axis facing would rotate the slab — refused, counted as skipped.
    useAppStore.getState().setPlaneAxisOrientation('x', 1)
    useAppStore.getState().setSelection(rectRegion(-1, 0, 0, 0))
    expect(useAppStore.getState().faceSelection()).toEqual({ faced: 0, skipped: 1 })
    expect(useAppStore.getState().model.chamfer.get(keyFor(0, 0))?.planeAxis).toBe('z')
  })

  it('counts already-faced cells as skipped and no-ops cleanly', () => {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('thin')
    s.beginStroke()
    s.paintCell(0, 0)
    s.commitStroke()

    const pastLen = useAppStore.getState().past.length
    useAppStore.getState().setSelection(rectRegion(0, 0, 0, 0))
    // Still on the authoring plane: nothing changes, no undo step recorded.
    const result = useAppStore.getState().faceSelection()
    expect(result).toEqual({ faced: 0, skipped: 1 })
    expect(useAppStore.getState().past.length).toBe(pastLen)
  })

  it('returns zeros with no selection', () => {
    expect(useAppStore.getState().faceSelection()).toEqual({ faced: 0, skipped: 0 })
  })
})
