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
