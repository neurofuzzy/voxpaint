import { beforeEach, describe, expect, it } from 'vitest'
import { pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { fineDivisionFor, fineRectRegion, forEachFineCell } from '@/engine/tools/fineSelection'
import { clearFineRegion } from '@/engine/grid/fineOps'
import { useAppStore } from './useAppStore'

const A = { kind: 'base', index: 0 } as never
const B = { kind: 'base', index: 1 } as never

function selectedFineCells(): Array<[number, number]> {
  const sel = useAppStore.getState().selection
  const out: Array<[number, number]> = []
  if (sel) forEachFineCell(sel, (fu, fv) => out.push([fu, fv]))
  return out
}

describe('sub-voxel wand', () => {
  let u0 = 0
  let v0 = 0
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
    s.setGridSplit(['x'])
    ;({ u: u0, v: v0 } = pixelFromGridCoord(useAppStore.getState().plane, [0, 0, 0]))
  })

  it('selects the colour-connected fine cells under the pointer', () => {
    useAppStore.getState().applyWandAt([0, 0, 0], [u0 * 2 + 1, v0])
    const cells = selectedFineCells()
    expect(cells).toHaveLength(2) // both halves of the A voxel; the B voxel is another colour
    expect(useAppStore.getState().selection?.fine).toBeDefined()
  })

  it('works on half a voxel: a lone surviving half selects just itself', () => {
    const plane = useAppStore.getState().plane
    const div = fineDivisionFor(plane, ['x'])
    useAppStore.setState((st) => { clearFineRegion(st.model, plane, fineRectRegion(div, u0 * 2 + 1, v0, u0 * 2 + 1, v0)) })
    useAppStore.getState().applyWandAt([0, 0, 0], [u0 * 2, v0])
    expect(selectedFineCells()).toHaveLength(1)
  })

  it('an empty fine cell clears the selection', () => {
    useAppStore.getState().applyWandAt([0, 0, 0], [u0 * 2, v0])
    expect(useAppStore.getState().selection).not.toBeNull()
    useAppStore.getState().applyWandAt([5, 0, 0], [(u0 + 5) * 2, v0])
    expect(useAppStore.getState().selection).toBeNull()
  })

  it('a rapid re-tap on a connected cell takes the whole occupied component', () => {
    useAppStore.getState().applyWandAt([0, 0, 0], [u0 * 2, v0])
    expect(selectedFineCells()).toHaveLength(2)
    useAppStore.getState().applyWandAt([0, 0, 0], [u0 * 2 + 1, v0])
    expect(selectedFineCells()).toHaveLength(4) // A and B voxels, every half
  })

  it('the whole grid keeps the original voxel wand', () => {
    useAppStore.getState().setGridDivision('whole')
    useAppStore.getState().applyWandAt([0, 0, 0])
    expect(useAppStore.getState().selection?.fine).toBeUndefined()
  })
})
