import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { useAppStore } from './useAppStore'

const PLANE = { axis: 'z' as const, orientation: 1 as const, offset: 0 }
const keyFor = (u: number, v: number) => encodeKey(...gridCoordFromPixel(PLANE, u, v))

/** Drives the real store to verify wedge-voxel painting: always succeeds (no more block-if-
 * unresolved), retries against neighbors painted later in the same stroke, freezes once truly
 * resolved, and exposes a click-to-rotate escape hatch for whatever's left at its rotation-0
 * fallback. */
describe('paintCell wedge handling', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setActiveVoxelKind('wedge')
  })

  it('paints a lone wedge on empty ground at rotation 0 instead of no-op', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    const painted = s.paintCell(4, 4)
    s.commitStroke()

    expect(painted).toBe(true)
    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    const cell = [...after.model.chamfer.values()][0]
    expect(cell.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: 0 })
  })

  it('resolves two adjacent wedges painted in the same stroke to their true corner rotation', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    // (4,4) then (4,3) i.e. north of it -> filled sides for (4,4) become {N} only still
    // insufficient alone, but painting a corner pair (west neighbor of (5,5) then (5,5) itself)
    // gives a true W+S=convex-shaped 2-neighbor match once both exist.
    s.paintCell(4, 5) // west neighbor
    s.paintCell(5, 4) // north neighbor - not adjacent to west, so pair with a real corner below
    s.paintCell(5, 5) // south+east of the first two: has W-filled (4,5) and N-filled (5,4) neighbors
    s.commitStroke()

    const after = useAppStore.getState()
    const cell = after.model.chamfer.get(keyFor(5, 5))!
    // W+N filled around (5,5) is a real 2-adjacent-orthogonal corner -> resolved, not defaulted.
    expect(cell.resolvedTo!.shapeKind).toBe('wedge')
    expect(cell.resolvedTo!.rotation).not.toBeUndefined()
  })

  it('re-painting an unresolved wedge in a later stroke cycles its rotation by 90 degrees', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    s.paintCell(4, 4)
    s.commitStroke()
    expect(useAppStore.getState().model.chamfer.get([...useAppStore.getState().model.chamfer.keys()][0])!.resolvedTo).toEqual({
      shapeKind: 'wedge',
      rotation: 0,
    })

    for (const expected of [1, 2, 3, 0] as const) {
      useAppStore.getState().beginStroke()
      useAppStore.getState().paintCell(4, 4)
      useAppStore.getState().commitStroke()
      const key = [...useAppStore.getState().model.chamfer.keys()][0]
      expect(useAppStore.getState().model.chamfer.get(key)!.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: expected })
    }
  })

  it('freezes a wedge once truly resolved mid-stroke, even if a later neighbor in the same stroke would change the classification', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    s.paintCell(4, 5) // west neighbor of (5,5)
    s.paintCell(5, 4) // north neighbor of (5,5)
    s.paintCell(5, 5) // resolves to a true W+N corner now
    const resolvedRotation = useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo!.rotation

    // Adding an east neighbor too (3 sides filled around (5,5)) would change classify()'s verdict
    // entirely (orthoCount 3 -> ramp), but (5,5) is already frozen as a wedge and must not flip.
    s.paintCell(6, 5)
    s.commitStroke()

    const after = useAppStore.getState()
    expect(after.model.chamfer.get(keyFor(5, 5))!.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: resolvedRotation })
  })
})
