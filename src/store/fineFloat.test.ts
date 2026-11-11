import { beforeEach, describe, expect, it } from 'vitest'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { subdivideCell } from '@/engine/grid/subdiv'
import { fineDivisionFor, fineRectRegion } from '@/engine/tools/fineSelection'
import { useAppStore } from './useAppStore'

const A = { kind: 'base', index: 0 } as never
const B = { kind: 'base', index: 1 } as never

function slots(key: string): Array<number | null> | number | undefined {
  const m = useAppStore.getState().model
  const sub = m.subdiv.get(key)
  if (sub) return sub.children.map((c) => (c ? (c.slot as { index: number }).index : null))
  return (m.color.get(key)?.paletteSlot as { index: number } | undefined)?.index
}

describe('sub-voxel floats (2D)', () => {
  let v = 0
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('T', 16)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.setGridDivision('whole')
    s.setActivePaletteSlot(A)
    s.beginStroke()
    s.paintCellAtCoord([0, 0, 0], 'z', 1)
    s.commitStroke()
    s.setActivePaletteSlot(B)
    s.beginStroke()
    s.paintCellAtCoord([1, 0, 0], 'z', 1)
    s.commitStroke()
    s.setPendingSplit(['x']) // halves along u (x) on the z plane
    v = pixelFromGridCoord(useAppStore.getState().plane, [0, 0, 0]).v
    const plane = useAppStore.getState().plane
    // fine u 1..2: x-high half of the A voxel + x-low half of the B voxel
    useAppStore.getState().setSelection(fineRectRegion(fineDivisionFor(plane, ['x']), 1, v, 2, v))
  })

  it('lifting takes exactly the selected halves', () => {
    useAppStore.getState().liftSelectionToFloat()
    const st = useAppStore.getState()
    expect(st.floatContent?.fine).toBeDefined()
    expect(slots('0,0,0')).toEqual([0, null])
    expect(slots('1,0,0')).toEqual([null, 1])
  })

  it('dropping in place restores the model', () => {
    useAppStore.getState().liftSelectionToFloat()
    useAppStore.getState().bakeFloatIfAny()
    // Identical halves fold back into plain cubes: a no-op lift/drop leaves the model as it was.
    expect(slots('0,0,0')).toBe(0)
    expect(slots('1,0,0')).toBe(1)
  })

  it('moves by one fine unit: the halves land half a voxel over', () => {
    useAppStore.getState().liftSelectionToFloat()
    const o = useAppStore.getState().floatOrigin!
    useAppStore.getState().moveFloatTo(o.originU, o.originV, 1, 0)
    useAppStore.getState().bakeFloatIfAny()
    // Footprint was fine u 1..2 -> now 2..3 (the whole B voxel): [A-half, B-half].
    expect(slots('0,0,0')).toEqual([0, null])
    expect(slots('1,0,0')).toEqual([0, 1])
  })

  it('moves by whole voxels too', () => {
    useAppStore.getState().liftSelectionToFloat()
    const o = useAppStore.getState().floatOrigin!
    useAppStore.getState().moveFloatTo(o.originU + 3, o.originV, 0, 0)
    useAppStore.getState().bakeFloatIfAny()
    expect(slots('3,0,0')).toEqual([null, 0])
    expect(slots('4,0,0')).toEqual([1, null])
    expect(slots('0,0,0')).toEqual([0, null]) // the source stays cleared
  })

  it('copy then paste in place leaves the source and lays the halves down', () => {
    useAppStore.getState().copySelection()
    useAppStore.getState().pasteClipboardInPlace()
    useAppStore.getState().bakeFloatIfAny()
    expect(slots('0,0,0')).toBe(0)
    expect(slots('1,0,0')).toBe(1)
  })

  it('rotate and mirror keep the content (a footprint of two halves stays two halves)', () => {
    useAppStore.getState().transformFloat('mirror-h')
    const st = useAppStore.getState()
    expect(st.floatContent?.fine).toBeDefined()
    useAppStore.getState().bakeFloatIfAny()
    // Mirroring the two selected halves across their frame swaps them in place.
    expect(slots('0,0,0')).toEqual([0, 1])
    expect(slots('1,0,0')).toEqual([0, 1])
  })

  it('a rotate turns the u-split content into a v-split', () => {
    useAppStore.getState().transformFloat('rotate')
    const st = useAppStore.getState()
    expect(st.floatContent?.fine).toMatchObject({ su: 1, sv: 2 })
    useAppStore.getState().bakeFloatIfAny()
    const m = useAppStore.getState().model
    expect(m.subdiv.size).toBeGreaterThan(0)
  })
})

describe('sub-voxel floats preserve beveled children', () => {
  it('lifting, moving, and dropping a ramp child keeps its shape (not a plain cube)', () => {
    const s = useAppStore.getState()
    s.newProject('T', 16)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.setActivePaletteSlot(A)
    s.beginStroke()
    s.paintCellAtCoord([0, 0, 0], 'z', 1)
    s.commitStroke()
    // Split the cube and bevel its x-high half by hand (as auto-bevel would leave it).
    useAppStore.setState((state) => {
      subdivideCell(state.model, [0, 0, 0], ['x'])
      const sub = state.model.subdiv.get('0,0,0')!
      sub.children[1] = {
        slot: B,
        chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } },
      }
    })
    const plane = useAppStore.getState().plane
    const v = pixelFromGridCoord(plane, [0, 0, 0]).v
    // Select exactly the beveled half, lift it, and shift it half a voxel over.
    useAppStore.getState().setSelection(fineRectRegion(fineDivisionFor(plane, ['x']), 1, v, 1, v))
    useAppStore.getState().liftSelectionToFloat()
    expect(useAppStore.getState().floatContent?.fine).toBeDefined()
    const o = useAppStore.getState().floatOrigin!
    useAppStore.getState().moveFloatTo(o.originU, o.originV, 1, 0)
    // Beveled detail is NOT atomic: the half-step sticks (no whole-voxel snap).
    expect(useAppStore.getState().floatOrigin!.subU).toBe(1)
    useAppStore.getState().bakeFloatIfAny()
    // The source half is gone; the dropped half is still a ramp, not a plain cube.
    expect(slots('0,0,0')).toEqual([0, null])
    const moved = useAppStore.getState().model.subdiv.get('1,0,0')!
    expect(moved.children[1]).toBeNull()
    expect((moved.children[0]!.slot as { index: number }).index).toBe(1)
    expect(moved.children[0]!.chamfer?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 0 })
  })
})

describe('sub-voxel floats holding a whole chamfer cell', () => {
  it('snap the offset to whole voxels — unit-scale shapes have no half-voxel position', () => {
    const s = useAppStore.getState()
    s.newProject('T', 16)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.setActiveVoxelKind('ramp')
    s.beginStroke()
    s.paintCellAtCoord([0, 0, 0], 'z', 1)
    s.commitStroke()
    expect(useAppStore.getState().model.chamfer.has('0,0,0')).toBe(true)
    s.setPendingSplit(['x'])
    const plane = useAppStore.getState().plane
    const v = pixelFromGridCoord(plane, [0, 0, 0]).v
    useAppStore.getState().setSelection(fineRectRegion(fineDivisionFor(plane, ['x']), 0, v, 1, v))
    useAppStore.getState().liftSelectionToFloat()
    expect(useAppStore.getState().floatContent?.fine).toBeDefined()
    const o = useAppStore.getState().floatOrigin!
    // A half-step request snaps to a whole multiple (su=2); the shape never sits half-off.
    useAppStore.getState().moveFloatTo(o.originU, o.originV, 1, 0)
    const landed = useAppStore.getState().floatOrigin!
    expect(landed.subU! % 2).toBe(0)
    useAppStore.getState().bakeFloatIfAny()
    expect(useAppStore.getState().model.chamfer.has(`${landed.originU},0,0`)).toBe(true)
  })
})
