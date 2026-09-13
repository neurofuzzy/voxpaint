import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
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
