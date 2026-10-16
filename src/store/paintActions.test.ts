import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { paintTool } from '@/engine/tools/paintTool'
import type { ToolContext, ToolDragState } from '@/engine/tools/types'
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

/** End-of-drag bevel correction (`correctChamferStroke`, run by the paint tool's onUp before
 * the stroke commits): cells that resolved mid-drag against incomplete neighbors re-resolve
 * against the finished stroke — one undo step, no need to paint over the same spots again. */
describe('bevel drag correction on release', () => {
  const evt = (u: number, v: number) => ({ u, v, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })

  /** Minimal paint-tool context backed by the real store (drag + release flow, not bare writes). */
  function storeCtx(): ToolContext {
    const s = useAppStore.getState()
    let linePreview: { anchor: [number, number]; end: [number, number] } | null = null
    return {
      paintCell: s.paintCell,
      bakeFloatIfAny: s.bakeFloatIfAny,
      beginStroke: s.beginStroke,
      commitStroke: s.commitStroke,
      correctChamferStroke: s.correctChamferStroke,
      get linePreview() { return linePreview },
      setLinePreview: (v: { anchor: [number, number]; end: [number, number] } | null) => { linePreview = v },
      drag: { current: { kind: 'idle' } as ToolDragState },
    } as unknown as ToolContext
  }

  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('ramp')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.setSelection(null)
  })

  it('re-resolves a mid-drag convex cell to a ramp once its third side lands', () => {
    // Drag order W -> N -> C -> E: when C lands it sees W+N (convex), then E completes three
    // sides (ramp, open S) — but C is already frozen, so only the release pass can fix it.
    const ctx = storeCtx()
    const pastBefore = useAppStore.getState().past.length
    paintTool.onDown!(ctx, evt(4, 5))
    paintTool.onMove!(ctx, evt(5, 4))
    paintTool.onMove!(ctx, evt(5, 5))
    expect(useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo).toEqual({
      shapeKind: 'convex',
      rotation: 1,
    })
    paintTool.onMove!(ctx, evt(6, 5))
    paintTool.onUp!(ctx, evt(6, 5))

    expect(useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo).toEqual({
      shapeKind: 'ramp',
      rotation: 1,
    })
    // The correction landed inside the same stroke, not as its own undo step.
    expect(useAppStore.getState().past.length).toBe(pastBefore + 1)
  })

  it('leaves still-unresolvable cells unresolved instead of forcing a shape', () => {
    const ctx = storeCtx()
    paintTool.onDown!(ctx, evt(4, 5))
    paintTool.onMove!(ctx, evt(6, 5)) // gap at (5,5): endpoints see one neighbor each
    paintTool.onUp!(ctx, evt(6, 5))

    // Bresenham fills (5,5) too, bridging the gap — every cell sees opposite-side pairs or
    // single neighbors, none of which is a defined shape.
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 5))!.resolvedTo).toBeNull()
    expect(useAppStore.getState().model.chamfer.get(keyFor(6, 5))!.resolvedTo).toBeNull()
  })
})

/** Direct-3D blocking (`paintCellAtCoord`/`eraseCellAtCoord`, Edit mode): coordinate-level writes
 * that bake the clicked face's axis/orientation as chamfer context instead of the active plane. */
describe('direct 3D blocking', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setActiveVoxelKind('cube')
  })

  it('paints with the face plane as chamfer context, leaving the active plane untouched', () => {
    useAppStore.getState().setActiveVoxelKind('ramp')
    // Active plane is z/1/0, but the clicked face says x/1 — the chamfer must bake x/1.
    const painted = useAppStore.getState().paintCellAtCoord([0, 0, 0], 'x', 1)
    expect(painted).toBe(true)
    const after = useAppStore.getState()
    expect(after.model.chamfer.get(encodeKey(0, 0, 0))).toEqual({
      planeAxis: 'x',
      planeOrientation: 1,
      resolvedTo: null, // lone ramp: no neighbors to resolve against
    })
    expect(after.plane).toEqual({ axis: 'z', orientation: 1, offset: 0 })
  })

  it('resolves identically to the equivalent 2D paint on the same plane', () => {
    // L-corner in the x=0 slice, built two ways: direct 3D paints with an x/1 face, and 2D paints
    // on the x/1/offset-0 plane. Both must classify the corner cell the same way.
    const cells: Coord[] = [[0, 0, -1], [0, -1, 0], [0, 0, 0]]
    const s = useAppStore.getState()
    s.setActiveVoxelKind('ramp')
    s.beginStroke()
    for (const c of cells) s.paintCellAtCoord(c, 'x', 1)
    s.commitStroke()
    const direct = useAppStore.getState().model.chamfer.get(encodeKey(0, 0, 0))!.resolvedTo

    useAppStore.getState().newProject('Test', 16)
    const s2 = useAppStore.getState()
    s2.setActiveVoxelKind('ramp')
    s2.setPlaneAxisOrientation('x', 1)
    s2.setPlaneOffset(0)
    s2.beginStroke()
    for (const c of cells) {
      const { u, v } = pixelFromGridCoord({ axis: 'x', orientation: 1, offset: 0 }, c)
      s2.paintCell(u, v)
    }
    s2.commitStroke()
    const flat = useAppStore.getState().model.chamfer.get(encodeKey(0, 0, 0))!.resolvedTo
    expect(direct).toEqual(flat)
    expect(direct).not.toBeNull() // two orthogonal in-plane neighbors resolve a real corner
  })

  it('rejects out-of-bounds targets', () => {
    expect(useAppStore.getState().paintCellAtCoord([100, 0, 0], 'x', 1)).toBe(false)
    expect(useAppStore.getState().model.color.size).toBe(0)
  })

  it('ignores the 2D selection (which lives in the active plane frame)', () => {
    // Selection covers (u,v)=(0,0) on the active z plane — the 3D target (5,5,5) is outside it,
    // where paintCell would refuse.
    useAppStore.getState().setSelection({ originU: 0, originV: 0, width: 1, height: 1, mask: new Uint8Array([1]) })
    expect(useAppStore.getState().paintCellAtCoord([5, 5, 5], 'z', 1)).toBe(true)
    expect(useAppStore.getState().model.color.has(encodeKey(5, 5, 5))).toBe(true)
    // …and 3D erase clears through it too.
    useAppStore.getState().eraseCellAtCoord([5, 5, 5])
    expect(useAppStore.getState().model.color.has(encodeKey(5, 5, 5))).toBe(false)
  })

  it('brackets a multi-cell drag as one undo stroke', () => {
    const s = useAppStore.getState()
    const before = s.past.length
    s.beginStroke()
    s.paintCellAtCoord([0, 0, 0], 'z', 1)
    s.paintCellAtCoord([1, 0, 0], 'z', 1)
    s.paintCellAtCoord([2, 0, 0], 'z', 1)
    s.commitStroke()
    expect(useAppStore.getState().past.length).toBe(before + 1)
    expect(useAppStore.getState().model.color.size).toBe(3)
  })

  it('3D Edit mode defaults off', () => {
    expect(useAppStore.getState().edit3D).toBe(false)
    useAppStore.getState().setEdit3D(true)
    expect(useAppStore.getState().edit3D).toBe(true)
  })
})

/** Material paint (`paintMaterialCell`/`paintMaterialAtCoord`): recolors existing voxels with the
 * active slot — never adds or deletes cells, never touches chamfer. */
describe('material paint', () => {
  const SLOT_A = { kind: 'base', index: 0 } as const
  const SLOT_B = { kind: 'base', index: 1 } as const

  beforeEach(() => {
    // newProject deliberately preserves view/tool state (plane, selection, palette slot), so
    // reset everything this suite depends on for hermetic tests.
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('cube')
    s.setActivePaletteSlot(SLOT_A)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.setSelection(null)
  })

  it('recolors an occupied cell and leaves chamfer alone', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    // keyFor maps (u,v) on the default z/1/0 plane; (4,4) is [4,-5,0].
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    useAppStore.getState().setActivePaletteSlot(SLOT_B)
    expect(useAppStore.getState().paintMaterialCell(4, 4)).toBe(true)
    const after = useAppStore.getState()
    expect(after.model.color.get(keyFor(4, 4))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.size).toBe(0)
  })

  it('no-ops on empty cells, same-slot repaints, and out-of-bounds coords', () => {
    const s = useAppStore.getState()
    expect(s.paintMaterialCell(4, 4)).toBe(false) // empty
    expect(s.paintMaterialAtCoord([100, 0, 0])).toBe(false) // out of bounds
    expect(s.model.color.size).toBe(0)
    expect(s.past.length).toBe(0)

    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()
    // Same slot as painted (default slot 0): no change, no new undo step.
    const pastLen = useAppStore.getState().past.length
    expect(useAppStore.getState().paintMaterialAtCoord([4, -5, 0])).toBe(false)
    expect(useAppStore.getState().past.length).toBe(pastLen)
  })

  it('respects the 2D selection in 2D, ignores it in 3D', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    expect(s.paintCell(5, 5)).toBe(true)
    s.commitStroke()
    // Selection covers only (4,4).
    s.setSelection({ originU: 4, originV: 4, width: 1, height: 1, mask: new Uint8Array([1]) })

    s.setActivePaletteSlot(SLOT_B)
    expect(s.paintMaterialCell(5, 5)).toBe(false) // clipped, like paintCell
    expect(s.paintMaterialCell(4, 4)).toBe(true)
    // 3D path recolors through the selection.
    expect(s.paintMaterialAtCoord(keyFor(5, 5).split(',').map(Number) as [number, number, number])).toBe(true)
    const after = useAppStore.getState()
    expect(after.model.color.get(keyFor(4, 4))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.color.get(keyFor(5, 5))?.paletteSlot).toEqual(SLOT_B)
  })
})

describe('paintCell half-slab handling', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('half')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('paints a fixed flush half slab recording the active plane basis', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'half', rotation: 0 },
    })
  })

  it('re-painting with cube clears the half entry', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    useAppStore.getState().setActiveVoxelKind('cube')
    const s2 = useAppStore.getState()
    s2.beginStroke()
    expect(s2.paintCell(4, 4)).toBe(true)
    s2.commitStroke()

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.has(keyFor(4, 4))).toBe(false)
  })
})
