import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { coverageKeys, fineDivisionFor, fineRectRegion, fineWorldBounds } from '@/engine/tools/fineSelection'
import { liveFineSelection3D } from './selection3DSlice'
import { useAppStore } from './useAppStore'

describe('sub-voxel 3D selection', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('T', 16)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.setGridDivision('whole')
    s.beginStroke()
    s.paintCellAtCoord([0, 0, 0], 'z', 1)
    s.paintCellAtCoord([1, 0, 0], 'z', 1)
    s.commitStroke()
  })

  function selectHalfAcross() {
    const s = useAppStore.getState()
    s.setGridSplit(['x']) // halves along u (x) on the z plane
    const plane = { ...useAppStore.getState().plane }
    const div = fineDivisionFor(plane, ['x'])
    // fine u 1..2: x-high half of cell 0 + x-low half of cell 1.
    const { v } = pixelFromGridCoord(plane, [0, 0, 0])
    useAppStore.getState().setSelectedFine({ region: fineRectRegion(div, 1, v, 2, v), plane })
    return plane
  }

  it('commits a fine window with its coverage set, and it stays live', () => {
    const plane = selectHalfAcross()
    const st = useAppStore.getState()
    const fine = liveFineSelection3D(st)
    expect(fine).not.toBeNull()
    expect([...st.selectedCells].sort()).toEqual(coverageKeys(plane, fine!.region).sort())
    expect(fineWorldBounds(plane, fine!.region)).toEqual({ lo: [0.5, 0, 0], hi: [1.5, 1, 1] })
  })

  it('any other write to the selected set retires the fine refinement', () => {
    selectHalfAcross()
    useAppStore.getState().setSelectedCells(new Set([encodeKey(...gridCoordFromPixel(useAppStore.getState().plane, 0, 0))]))
    expect(liveFineSelection3D(useAppStore.getState())).toBeNull()
  })

  it('delete removes exactly the selected halves', () => {
    selectHalfAcross()
    useAppStore.getState().deleteCells3D()
    const m = useAppStore.getState().model
    const a = m.subdiv.get('0,0,0')!
    const b = m.subdiv.get('1,0,0')!
    expect(a.children.map((c) => (c ? 1 : 0))).toEqual([1, 0]) // x-low survives
    expect(b.children.map((c) => (c ? 1 : 0))).toEqual([0, 1]) // x-high survives
  })

  it('copy carries only the selected parts', () => {
    selectHalfAcross()
    useAppStore.getState().copyCells3D()
    const clip = useAppStore.getState().clipboard!
    expect(clip.cells).toHaveLength(2)
    for (const c of clip.cells) expect(c.subdiv?.children.filter(Boolean)).toHaveLength(1)
  })

  it('lifting and dropping a sub-voxel selection moves exactly those halves (fine steps)', () => {
    selectHalfAcross()
    const st = useAppStore.getState()
    st.liftCellsToFloat(st.selectedCells)
    const o = useAppStore.getState().floatOrigin!
    expect(useAppStore.getState().floatContent?.fine).toBeDefined()
    useAppStore.getState().moveFloatCellsTo(o.originU, o.originV, 1, 0) // half a voxel over
    useAppStore.getState().bakeFloatIfAny()
    const m = useAppStore.getState().model
    expect(m.subdiv.get('0,0,0')!.children.map((c) => (c ? 1 : 0))).toEqual([1, 0])
    // The B voxel now holds two same-colour halves: folded back into one cube.
    expect(m.color.has('1,0,0')).toBe(true)
    expect(m.subdiv.has('1,0,0')).toBe(false)
  })

  it('rotating a sub-voxel selection keeps it a sub-voxel selection', () => {
    selectHalfAcross()
    useAppStore.getState().rotateCells3D('mirror-h')
    const st = useAppStore.getState()
    expect(st.floatContent).toBeNull()
    expect(liveFineSelection3D(st)).not.toBeNull()
  })

  it('pasting a sub-voxel copy floats it as sub-voxel content', () => {
    selectHalfAcross()
    useAppStore.getState().copyCells3D()
    useAppStore.getState().pasteCells3D()
    expect(useAppStore.getState().floatContent?.fine).toBeDefined()
    useAppStore.getState().bakeFloatIfAny()
    expect(useAppStore.getState().model.color.has('0,0,0')).toBe(true) // identical halves fold back
  })

  it('fill paints exactly the selected halves', () => {
    selectHalfAcross()
    const s = useAppStore.getState()
    s.setActivePaletteSlot({ kind: 'base', index: 3 } as never)
    s.fillSelection()
    const a = useAppStore.getState().model.subdiv.get('0,0,0')!
    expect(a.children.map((c) => c?.slot.index)).toEqual([a.children[0]!.slot.index, 3])
    expect(a.children[0]!.slot.index).not.toBe(3)
  })
})
