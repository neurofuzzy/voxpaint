import { beforeEach, describe, expect, it } from 'vitest'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { useAppStore } from './useAppStore'

const SLOT_A: PaletteSlotRef = { kind: 'base', index: 0 }

function paintVoxels(...coords: Array<[number, number, number]>) {
  const s = useAppStore.getState()
  s.beginStroke()
  useAppStore.setState((state) => {
    for (const coord of coords) {
      state.model.color.set(encodeKey(...coord), { paletteSlot: SLOT_A })
    }
  })
  s.commitStroke()
}

function boxIds() {
  return Object.fromEntries(useAppStore.getState().rigBoxes.map((b) => [b.name, b.id]))
}

function modelKeys() {
  return [...useAppStore.getState().model.color.keys()].sort()
}

describe('part-move drags', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('moves the box, its subtree, and their voxels together as one undo entry', () => {
    paintVoxels([0, 0, 0], [1, 0, 0], [2, 0, 0], [5, 0, 0])
    const s = useAppStore.getState()
    s.addRigBox({ id: 'p', name: 'part', min: [0, 0, 0], max: [2, 0, 0], parentId: null, pivot: null })
    s.addRigBox({ id: 'c', name: 'child', min: [2, 0, 0], max: [2, 0, 0], parentId: 'p', pivot: null })

    const animBefore = useAppStore.getState().animPast.length
    const pastBefore = useAppStore.getState().past.length
    expect(useAppStore.getState().beginPartMove(boxIds().part)).toBe(true)
    useAppStore.getState().updatePartMove([2, 0, 0])
    useAppStore.getState().endPartMove()

    // Voxels rode along; the uninvolved voxel stays put.
    expect(modelKeys()).toEqual(
      [[2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0]].map((c) => encodeKey(...(c as [number, number, number]))).sort(),
    )
    const after = useAppStore.getState()
    expect(after.rigBoxes.find((b) => b.id === 'p')).toMatchObject({ min: [2, 0, 0], max: [4, 0, 0] })
    expect(after.rigBoxes.find((b) => b.id === 'c')).toMatchObject({ min: [4, 0, 0], max: [4, 0, 0] })
    // One Animate-stack entry, nothing on the voxel stack.
    expect(after.animPast.length).toBe(animBefore + 1)
    expect(after.past.length).toBe(pastBefore)

    // A single animUndo restores voxels AND boxes together.
    useAppStore.getState().animUndo()
    const undone = useAppStore.getState()
    expect(modelKeys()).toEqual(
      [[0, 0, 0], [1, 0, 0], [2, 0, 0], [5, 0, 0]].map((c) => encodeKey(...(c as [number, number, number]))).sort(),
    )
    expect(undone.rigBoxes.find((b) => b.id === 'p')).toMatchObject({ min: [0, 0, 0], max: [2, 0, 0] })
    expect(undone.rigBoxes.find((b) => b.id === 'c')).toMatchObject({ min: [2, 0, 0], max: [2, 0, 0] })

    useAppStore.getState().animRedo()
    expect(modelKeys()).toEqual(
      [[2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0]].map((c) => encodeKey(...(c as [number, number, number]))).sort(),
    )
  })

  it('records nothing for a tap without drag', () => {
    paintVoxels([0, 0, 0])
    useAppStore.getState().addRigBox({ id: 'p', name: 'part', min: [0, 0, 0], max: [0, 0, 0], parentId: null, pivot: null })
    const animBefore = useAppStore.getState().animPast.length

    expect(useAppStore.getState().beginPartMove(boxIds().part)).toBe(true)
    useAppStore.getState().endPartMove()

    expect(useAppStore.getState().animPast.length).toBe(animBefore)
    expect(modelKeys()).toEqual([encodeKey(0, 0, 0)])
  })

  it('clamps boxes and voxels to the identical shift at the cube edge', () => {
    paintVoxels([6, 0, 0])
    useAppStore.getState().addRigBox({ id: 'p', name: 'part', min: [6, 0, 0], max: [6, 0, 0], parentId: null, pivot: null })

    expect(useAppStore.getState().beginPartMove(boxIds().part)).toBe(true)
    // +5 requested, only +1 fits before the working-cube edge (hi = 7).
    useAppStore.getState().updatePartMove([5, 0, 0])
    useAppStore.getState().endPartMove()

    expect(modelKeys()).toEqual([encodeKey(7, 0, 0)])
    expect(useAppStore.getState().rigBoxes[0]).toMatchObject({ min: [7, 0, 0], max: [7, 0, 0] })
  })

  it('carries chamfer records verbatim into free space', () => {
    paintVoxels([0, 0, 0])
    const s = useAppStore.getState()
    s.beginStroke()
    useAppStore.setState((state) => {
      state.model.chamfer.set(encodeKey(0, 0, 0), { planeAxis: 'z', planeOrientation: 1, resolvedTo: null })
    })
    s.commitStroke()
    useAppStore.getState().addRigBox({ id: 'p', name: 'part', min: [0, 0, 0], max: [0, 0, 0], parentId: null, pivot: null })

    expect(useAppStore.getState().beginPartMove(boxIds().part)).toBe(true)
    useAppStore.getState().updatePartMove([2, 0, 0])
    useAppStore.getState().endPartMove()

    const after = useAppStore.getState()
    expect(after.model.color.get(encodeKey(2, 0, 0))).toEqual({ paletteSlot: SLOT_A })
    expect(after.model.chamfer.get(encodeKey(2, 0, 0))).toEqual({ planeAxis: 'z', planeOrientation: 1, resolvedTo: null })
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
  })

  it('overlap fuses on drop, but scrubbing back restores every victim exactly', () => {
    paintVoxels([0, 0, 0], [1, 0, 0])
    useAppStore.getState().addRigBox({ id: 'p', name: 'part', min: [0, 0, 0], max: [0, 0, 0], parentId: null, pivot: null })
    const before = modelKeys()

    expect(useAppStore.getState().beginPartMove(boxIds().part)).toBe(true)
    // Drag onto the occupied neighbor: it fuses (gone from the model for now).
    useAppStore.getState().updatePartMove([1, 0, 0])
    expect(modelKeys()).toEqual([encodeKey(1, 0, 0)])
    // Drag back: the victim comes back, bit-identical.
    useAppStore.getState().updatePartMove([0, 0, 0])
    expect(modelKeys()).toEqual(before)
    useAppStore.getState().endPartMove()
    expect(modelKeys()).toEqual(before)
    // A fused-then-restored round trip nets no model change — yet still brackets cleanly.
    useAppStore.getState().animUndo()
    expect(modelKeys()).toEqual(before)
  })

  it('fused victims come back with undo', () => {
    paintVoxels([0, 0, 0], [1, 0, 0])
    useAppStore.getState().addRigBox({ id: 'p', name: 'part', min: [0, 0, 0], max: [0, 0, 0], parentId: null, pivot: null })
    const before = modelKeys()

    expect(useAppStore.getState().beginPartMove(boxIds().part)).toBe(true)
    useAppStore.getState().updatePartMove([1, 0, 0])
    useAppStore.getState().endPartMove()
    expect(modelKeys()).toEqual([encodeKey(1, 0, 0)])

    useAppStore.getState().animUndo()
    expect(modelKeys()).toEqual(before)
    expect(useAppStore.getState().rigBoxes[0]).toMatchObject({ min: [0, 0, 0], max: [0, 0, 0] })
  })

  it('repeated updates accumulate absolutely — the box never flies off', () => {
    paintVoxels([0, 0, 0])
    useAppStore.getState().addRigBox({ id: 'p', name: 'part', min: [0, 0, 0], max: [0, 0, 0], parentId: null, pivot: null })

    expect(useAppStore.getState().beginPartMove(boxIds().part)).toBe(true)
    useAppStore.getState().updatePartMove([1, 0, 0])
    useAppStore.getState().updatePartMove([2, 0, 0])
    useAppStore.getState().updatePartMove([3, 0, 0])
    useAppStore.getState().endPartMove()

    // Absolute +3 from the press cell — not 1+2+3.
    expect(modelKeys()).toEqual([encodeKey(3, 0, 0)])
    expect(useAppStore.getState().rigBoxes[0]).toMatchObject({ min: [3, 0, 0], max: [3, 0, 0] })
  })

  it('moves the box alone when it holds no voxels', () => {
    useAppStore.getState().addRigBox({ id: 'p', name: 'empty', min: [0, 0, 0], max: [1, 0, 0], parentId: null, pivot: null })
    const animBefore = useAppStore.getState().animPast.length

    expect(useAppStore.getState().beginPartMove(boxIds().empty)).toBe(true)
    useAppStore.getState().updatePartMove([0, 2, 0])
    useAppStore.getState().endPartMove()

    expect(useAppStore.getState().rigBoxes[0]).toMatchObject({ min: [0, 2, 0], max: [1, 2, 0] })
    expect(useAppStore.getState().animPast.length).toBe(animBefore + 1)

    useAppStore.getState().animUndo()
    expect(useAppStore.getState().rigBoxes[0]).toMatchObject({ min: [0, 0, 0], max: [1, 0, 0] })
  })

  it('refuses unknown ids and ignores stray updates', () => {
    paintVoxels([0, 0, 0])
    expect(useAppStore.getState().beginPartMove('nope')).toBe(false)
    // No armed gesture: these are safe no-ops.
    useAppStore.getState().updatePartMove([3, 0, 0])
    useAppStore.getState().endPartMove()
    expect(modelKeys()).toEqual([encodeKey(0, 0, 0)])
    expect(useAppStore.getState().rigBoxes).toHaveLength(0)
  })

  it('scrubbing back and forth is exact (snapshot re-lay, not incremental)', () => {
    paintVoxels([0, 0, 0])
    useAppStore.getState().addRigBox({ id: 'p', name: 'part', min: [0, 0, 0], max: [0, 0, 0], parentId: null, pivot: null })

    expect(useAppStore.getState().beginPartMove(boxIds().part)).toBe(true)
    useAppStore.getState().updatePartMove([3, 0, 0])
    expect(modelKeys()).toEqual([encodeKey(3, 0, 0)])
    // Steering back to the start restores the exact original cell.
    useAppStore.getState().updatePartMove([0, 0, 0])
    expect(modelKeys()).toEqual([encodeKey(0, 0, 0)])
    expect(decodeKey(modelKeys()[0])).toEqual([0, 0, 0])
    useAppStore.getState().endPartMove()
  })
})
