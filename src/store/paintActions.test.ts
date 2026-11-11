import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Coord, SplitAxis } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { paintTool } from '@/engine/tools/paintTool'
import type { ToolContext, ToolDragState } from '@/engine/tools/types'
import { rectRegion } from '@/engine/tools/selectionMask'
import { useAppStore } from './useAppStore'

const PLANE: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0, half: null }
const keyFor = (u: number, v: number) => encodeKey(...gridCoordFromPixel(PLANE, u, v))

/** Drives the real store to verify wedge-voxel painting: always succeeds (no more block-if-
 * unresolved), retries against neighbors painted later in the same stroke, freezes once truly
 * resolved, and exposes a click-to-rotate escape hatch for whatever's left at its rotation-0
 * fallback. */
describe('paintCell wedge handling', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setActiveVoxelKind('wedge')
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
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

  it('re-clicking an unresolved wedge rotates three times, then advances the family', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    s.paintCell(4, 4)
    s.commitStroke()
    expect(useAppStore.getState().model.chamfer.get([...useAppStore.getState().model.chamfer.keys()][0])!.resolvedTo).toEqual({
      shapeKind: 'wedge',
      rotation: 0,
    })

    for (const expected of [1, 2, 3] as const) {
      useAppStore.getState().beginStroke()
      useAppStore.getState().paintCell(4, 4)
      useAppStore.getState().commitStroke()
      const key = [...useAppStore.getState().model.chamfer.keys()][0]
      expect(useAppStore.getState().model.chamfer.get(key)!.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: expected })
    }
    // Completing the full turn advances to the next family shape (ramp), stamped
    // verbatim at the home rotation so the step always lands on something visible.
    useAppStore.getState().beginStroke()
    useAppStore.getState().paintCell(4, 4)
    useAppStore.getState().commitStroke()
    const key = [...useAppStore.getState().model.chamfer.keys()][0]
    expect(useAppStore.getState().model.chamfer.get(key)!.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 0 })
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

  it('release correction re-applies the brush rotation instead of un-rotating the ramp', () => {
    // Same drag as the first test, but with the R-rotated brush: mid-drag C resolves convex
    // with the offset (paint time already applied it), and the release pass must keep it.
    useAppStore.getState().setLayoutMode('split')
    useAppStore.getState().setBrushRotation(2)
    const ctx = storeCtx()
    paintTool.onDown!(ctx, evt(4, 5))
    paintTool.onMove!(ctx, evt(5, 4))
    paintTool.onMove!(ctx, evt(5, 5))
    expect(useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo).toEqual({
      shapeKind: 'convex',
      rotation: 3, // autotile 1 + brush 2
    })
    paintTool.onMove!(ctx, evt(6, 5))
    paintTool.onUp!(ctx, evt(6, 5))

    // Autotile verdict is ramp rotation 1 (open S); the brush offset survives correction.
    expect(useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo).toEqual({
      shapeKind: 'ramp',
      rotation: 3,
    })
    useAppStore.getState().setBrushRotation(0)
  })

  it('wedge upgrade keeps the brush offset through the in-stroke retry and the release pass', () => {
    // Target painted first (unresolved fallback), neighbors land later in the same stroke:
    // both the in-stroke retry loop and correctChamferStroke must add the brush offset.
    const runWithBrush = (brush: 0 | 2) => {
      useAppStore.getState().newProject('Test', 16)
      const s = useAppStore.getState()
      s.setLayoutMode('split')
      s.setActiveVoxelKind('wedge')
      s.setPlaneAxisOrientation('z', 1)
      s.setPlaneOffset(0)
      s.setBrushRotation(brush)
      s.beginStroke()
      s.paintCell(5, 5) // lone wedge: fallback rotation (0 + brush), pending upgrade
      expect(useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo).toEqual({
        shapeKind: 'wedge',
        rotation: brush,
      })
      // Neighbors painted as wedges: each wedge paint runs the in-stroke retry loop over all
      // pending cells (cube paints would not — the loop lives in the wedge branch).
      s.paintCell(4, 5) // west neighbor — corner still incomplete
      expect(useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo).toEqual({
        shapeKind: 'wedge',
        rotation: brush,
      })
      s.paintCell(5, 4) // north neighbor — completes a true W+N corner
      const mid = useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo
      s.correctChamferStroke()
      s.commitStroke()
      useAppStore.getState().setBrushRotation(0)
      return { mid, final: useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo }
    }
    const plain = runWithBrush(0)
    expect(plain.mid!.shapeKind).toBe('wedge')
    const base = plain.mid!.rotation
    const rotated = runWithBrush(2)
    const expected = { shapeKind: 'wedge', rotation: ((base + 2) % 4) as 0 | 1 | 2 | 3 }
    // The in-stroke retry already upgraded with the offset, before the release pass ran.
    expect(rotated.mid).toEqual(expected)
    expect(rotated.final).toEqual(expected)
  })
})

/** Direct-3D taps (`paintCellAtCoord`/`eraseCellAtCoord`, 3D-only layout): coordinate-level
 * writes that bake the clicked face's axis/orientation as chamfer context instead of the
 * active plane. */
describe('direct 3D blocking', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setActiveVoxelKind('cube')
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
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
    expect(after.plane).toEqual({ axis: 'z', orientation: 1, offset: 0, half: null })
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
      const { u, v } = pixelFromGridCoord({ axis: 'x', orientation: 1, offset: 0, half: null }, c)
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

  it('paints a recessed flush half slab: void toward the painter', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    // Painted on the z/1 plane (viewer on +z): the orientation negates so the void faces
    // the viewer and the voxel reads recessed next to full neighbors — never a flush
    // face hiding an internal pocket.
    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: -1,
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

  it('re-clicking a half slab spins its facing 90° per click, cycling back after four', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    // Recessed paint on z/1 starts at (z,−1); each re-click spins 90° about the paint-time V.
    const expected: [string, number][] = [
      ['x', 1],
      ['z', 1],
      ['x', -1],
      ['z', -1],
    ]
    for (const [axis, orientation] of expected) {
      useAppStore.getState().beginStroke()
      expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
      useAppStore.getState().commitStroke()
      expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
        planeAxis: axis,
        planeOrientation: orientation,
        resolvedTo: { shapeKind: 'half', rotation: 0 },
      })
    }
  })

  it('re-applying a half slab within the same stroke does not spin it', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    // Drag interpolation re-applies visited cells (Bresenham includes both endpoints) —
    // the stroke's own anchor must not rotate on revisit.
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'half', rotation: 0 },
    })
  })

  it('painting half over thin (and thin over half) re-bases instead of spinning', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    // Switch to thin: overwrite with the plane basis, not spin.
    useAppStore.getState().setActiveVoxelKind('thin')
    useAppStore.getState().beginStroke()
    expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
    useAppStore.getState().commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'thin', rotation: 0 },
    })

    // Thin re-click spins thin; switching back to half re-bases recessed.
    useAppStore.getState().beginStroke()
    expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
    useAppStore.getState().commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))?.planeAxis).toBe('x')

    useAppStore.getState().setActiveVoxelKind('half')
    useAppStore.getState().beginStroke()
    expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
    useAppStore.getState().commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'half', rotation: 0 },
    })
  })
})

describe('paintCell thin-slab click-to-rotate', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('thin')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('re-clicking a thin slab spins its facing 90° per click, cycling back after four', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'thin', rotation: 0 },
    })

    const expected: [string, number][] = [
      ['x', -1],
      ['z', -1],
      ['x', 1],
      ['z', 1],
    ]
    for (const [axis, orientation] of expected) {
      useAppStore.getState().beginStroke()
      expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
      useAppStore.getState().commitStroke()
      expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
        planeAxis: axis,
        planeOrientation: orientation,
        resolvedTo: { shapeKind: 'thin', rotation: 0 },
      })
    }
  })
})

describe('paintCell post-column handling', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('post')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('paints a centered column on the verbatim plane basis, frozen at rotation 0', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'post', rotation: 0 },
    })
  })

  it('re-clicking a post spins its long axis 90° per click, cycling back after four', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    // Same cycle as the thin slab painted on the same plane (shapeKind/rotation preserved).
    const expected: [string, number][] = [
      ['x', -1],
      ['z', -1],
      ['x', 1],
      ['z', 1],
    ]
    for (const [axis, orientation] of expected) {
      useAppStore.getState().beginStroke()
      expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
      useAppStore.getState().commitStroke()
      expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
        planeAxis: axis,
        planeOrientation: orientation,
        resolvedTo: { shapeKind: 'post', rotation: 0 },
      })
    }
  })

  it('re-applying a post within the same stroke does not spin it', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'post', rotation: 0 },
    })
  })

  it('re-painting with cube clears the post entry', () => {
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

describe('paintCell quarter-column handling', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('quarter')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('paints a NE corner column on the verbatim plane basis', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'quarter', rotation: 0 },
    })
  })

  it('re-clicking a quarter cycles its occupied corner, wrapping after four', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    for (const rotation of [1, 2, 3, 0]) {
      useAppStore.getState().beginStroke()
      expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
      useAppStore.getState().commitStroke()
      expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
        planeAxis: 'z',
        planeOrientation: 1,
        resolvedTo: { shapeKind: 'quarter', rotation },
      })
    }
  })

  it('re-applying a quarter within the same stroke does not cycle it', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'quarter', rotation: 0 },
    })
  })

  it('painting quarter over post re-bases instead of cycling', () => {
    useAppStore.getState().setActiveVoxelKind('post')
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    useAppStore.getState().setActiveVoxelKind('quarter')
    useAppStore.getState().beginStroke()
    expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
    useAppStore.getState().commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'quarter', rotation: 0 },
    })
  })
})

describe('paintCell flat-quad handling', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('flat')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('paints a centre quad on the verbatim plane basis, frozen at rotation 0', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flat', rotation: 0 },
    })
  })

  it('re-clicking a flat spins its facing 90° per click, cycling back after four', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    // Same cycle as the thin slab painted on the same plane.
    const expected: [string, number][] = [
      ['x', -1],
      ['z', -1],
      ['x', 1],
      ['z', 1],
    ]
    for (const [axis, orientation] of expected) {
      useAppStore.getState().beginStroke()
      expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
      useAppStore.getState().commitStroke()
      expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
        planeAxis: axis,
        planeOrientation: orientation,
        resolvedTo: { shapeKind: 'flat', rotation: 0 },
      })
    }
  })

  it('re-applying a flat within the same stroke does not spin it', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flat', rotation: 0 },
    })
  })

  it('re-painting with cube clears the flat entry', () => {
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

describe('paintCell flat-wedge handling', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('flatwedge')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('paints an open-NE diagonal quad on the verbatim plane basis', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flatwedge', rotation: 0 },
    })
  })

  it('re-clicking a flat wedge advances its rotation, wrapping after four', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    for (const rotation of [1, 2, 3, 0]) {
      useAppStore.getState().beginStroke()
      expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
      useAppStore.getState().commitStroke()
      expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
        planeAxis: 'z',
        planeOrientation: 1,
        resolvedTo: { shapeKind: 'flatwedge', rotation },
      })
    }
  })

  it('re-applying a flat wedge within the same stroke does not advance it', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flatwedge', rotation: 0 },
    })
  })

  it('painting flatwedge over flat re-bases instead of advancing', () => {
    useAppStore.getState().setActiveVoxelKind('flat')
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    useAppStore.getState().setActiveVoxelKind('flatwedge')
    useAppStore.getState().beginStroke()
    expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
    useAppStore.getState().commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flatwedge', rotation: 0 },
    })
  })
})

/** Explicit corner kinds: frozen at paint time with the brush rotation, never autotiled. */
describe.each(['convex', 'concave'] as const)('paintCell explicit %s handling', (kind) => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind(kind)
    s.setBrushRotation(0)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('paints resolved at the brush rotation', () => {
    const s = useAppStore.getState()
    s.setBrushRotation(2)
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: kind, rotation: 2 },
    })
  })

  it('never autotiles, even surrounded by neighbors that would classify', () => {
    // Ring the target with cubes: an autotile paint here would resolve, the explicit kind must not.
    useAppStore.getState().setActiveVoxelKind('cube')
    const s = useAppStore.getState()
    s.beginStroke()
    for (const [u, v] of [[3, 4], [5, 4], [4, 3], [4, 5]] as const) expect(s.paintCell(u, v)).toBe(true)
    s.commitStroke()

    useAppStore.getState().setActiveVoxelKind(kind)
    useAppStore.getState().beginStroke()
    expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
    useAppStore.getState().commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: kind, rotation: 0 },
    })
  })

  it('re-clicking rotates three times, then advances to the next family shape', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    const nextShape = kind === 'convex' ? 'concave' : 'wedge'
    for (const rotation of [1, 2, 3]) {
      useAppStore.getState().beginStroke()
      expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
      useAppStore.getState().commitStroke()
      expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
        planeAxis: 'z',
        planeOrientation: 1,
        resolvedTo: { shapeKind: kind, rotation },
      })
    }
    // Completing the full turn advances the family instead of wrapping the rotation.
    useAppStore.getState().beginStroke()
    expect(useAppStore.getState().paintCell(4, 4)).toBe(true)
    useAppStore.getState().commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: nextShape, rotation: 0 },
    })
  })

  it('re-applying within the same stroke does not cycle it', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()

    expect(useAppStore.getState().model.chamfer.get(keyFor(4, 4))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: kind, rotation: 0 },
    })
  })
})

/** Clicking the yellow 3D selection box stamps the whole selection with the brush. */
describe('fillSelection (box click fills the window with the brush)', () => {
  const SLOT_A = { kind: 'base', index: 0 } as const
  const SLOT_B = { kind: 'base', index: 3 } as const

  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('cube')
    s.setActivePaletteSlot(SLOT_A)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  function paintAt(coord: Coord) {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCellAtCoord(coord, 'z', 1)).toBe(true)
    s.commitStroke()
  }

  it('fills a 3D set including empty cells, in one undo stroke', () => {
    paintAt([0, 0, 0])
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(1, 0, 0)]))
    useAppStore.getState().setActivePaletteSlot(SLOT_B)
    const strokes = useAppStore.getState().past.length
    useAppStore.getState().fillSelection()

    const after = useAppStore.getState()
    expect(after.model.color.get(encodeKey(0, 0, 0))?.paletteSlot).toEqual(SLOT_B)
    // The empty window cell gains a voxel too — the area fills, not just recolors.
    expect(after.model.color.get(encodeKey(1, 0, 0))?.paletteSlot).toEqual(SLOT_B)
    expect(after.model.chamfer.size).toBe(0) // cube brush writes no chamfers
    expect(after.past.length).toBe(strokes + 1)
  })

  it('classifies the brush in 3D-only like 2D (lone ramp stays unresolved)', () => {
    const s = useAppStore.getState()
    s.setLayoutMode('3d-only')
    s.setActiveVoxelKind('ramp')
    s.setSelectedCells(new Set([encodeKey(0, 0, 0)]))
    s.fillSelection()

    // No neighbors: autotile leaves the ramp unresolved, exactly like the 2D fill path.
    expect(useAppStore.getState().model.chamfer.get(encodeKey(0, 0, 0))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: null,
    })
  })

  it('fills every cell of a split-layout window, including empty space', () => {
    const s = useAppStore.getState()
    s.setLayoutMode('split')
    // 2x2 window on the z=0 slice (u,v -1..0 == x -1..0, y 0..-1).
    s.setSelection(rectRegion(-1, -1, 0, 0))
    s.setActivePaletteSlot(SLOT_B)
    const strokes = useAppStore.getState().past.length
    useAppStore.getState().fillSelection()

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(4)
    for (const key of after.model.color.keys()) {
      expect(after.model.color.get(key)?.paletteSlot).toEqual(SLOT_B)
    }
    expect(after.past.length).toBe(strokes + 1)
  })

  it('stamps instead of cycling: no re-click rotation on matching chamfers', () => {
    // A settled wedge at rotation 2: a real click would rotate it to 3, but a fill must
    // stamp the brush rotation (0) like a fresh paint.
    useAppStore.setState((s) => {
      s.model.color.set(encodeKey(0, 0, 0), { paletteSlot: { ...SLOT_A } })
      s.model.chamfer.set(encodeKey(0, 0, 0), {
        planeAxis: 'z',
        planeOrientation: 1,
        resolvedTo: { shapeKind: 'wedge', rotation: 2 },
      })
    })
    useAppStore.getState().setActiveVoxelKind('wedge')
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0)]))
    useAppStore.getState().fillSelection()

    expect(useAppStore.getState().model.chamfer.get(encodeKey(0, 0, 0))?.resolvedTo).toEqual({
      shapeKind: 'wedge',
      rotation: 0,
    })
  })

  it('no-ops with no selection and drops out-of-grid keys', () => {
    useAppStore.getState().fillSelection()
    expect(useAppStore.getState().past.length).toBe(0)

    paintAt([0, 0, 0])
    useAppStore.getState().setSelectedCells(new Set([encodeKey(0, 0, 0), encodeKey(900, 0, 0)]))
    const strokes = useAppStore.getState().past.length
    useAppStore.getState().fillSelection()
    expect(useAppStore.getState().model.color.size).toBe(1)
    expect(useAppStore.getState().past.length).toBe(strokes + 1)
  })
})

/** 3D shift-paint (`paintLineAtCoord`, 3D-only layout): plain taps paint one cell and anchor;
 * shift-taps paint the dominant-axis line from the anchor in one undo stroke. */
describe('3D shift-paint lines', () => {
  const SLOT_A = { kind: 'base', index: 0 } as const
  const SLOT_B = { kind: 'base', index: 1 } as const

  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setLayoutMode('3d-only')
    s.setActiveVoxelKind('cube')
    s.setActivePaletteSlot(SLOT_A)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('plain tap paints one cell and sets the anchor', () => {
    expect(useAppStore.getState().paintLineAtCoord([0, 0, 0], false)).toBe(true)

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.paintLineAnchor).toEqual({ coord: [0, 0, 0], axis: 'z', orientation: 1 })
    expect(after.past.length).toBe(1)
  })

  it('shift-tap draws the dominant-axis line in one stroke', () => {
    const s = useAppStore.getState()
    expect(s.paintLineAtCoord([0, 0, 0], false)).toBe(true)
    expect(s.paintLineAtCoord([3, 0, 0], true)).toBe(true)

    const after = useAppStore.getState()
    for (const x of [0, 1, 2, 3]) {
      expect(after.model.color.has(encodeKey(x, 0, 0))).toBe(true)
    }
    expect(after.model.color.size).toBe(4)
    expect(after.past.length).toBe(2)
    // The tap re-anchors for chaining.
    expect(after.paintLineAnchor?.coord).toEqual([3, 0, 0])
  })

  it('locks to the farther plane axis', () => {
    const s = useAppStore.getState()
    expect(s.paintLineAtCoord([0, 0, 0], false)).toBe(true)
    // |du| = 1, |dv| = 2 on the z plane → v line at the anchor's u.
    expect(s.paintLineAtCoord([1, 2, 0], true)).toBe(true)

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(3)
    const ys = [...after.model.color.keys()].map((k) => k.split(',').map(Number))
    expect(ys.every(([x, , z]) => x === 0 && z === 0)).toBe(true)
    expect(ys.map(([, y]) => y).sort()).toEqual([0, 1, 2])
  })

  it('shift-tap without an anchor paints one and anchors', () => {
    useAppStore.getState().clearPaintLineAnchor()
    expect(useAppStore.getState().paintLineAtCoord([2, 2, 0], true)).toBe(true)

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.paintLineAnchor?.coord).toEqual([2, 2, 0])
  })

  it('lines replace occupied cells without growing the model', () => {
    const s = useAppStore.getState()
    expect(s.paintLineAtCoord([2, 0, 0], false)).toBe(true)
    expect(s.paintLineAtCoord([0, 0, 0], false)).toBe(true)
    expect(s.paintLineAtCoord([3, 0, 0], true)).toBe(true)

    const after = useAppStore.getState()
    for (const x of [0, 1, 2, 3]) {
      expect(after.model.color.has(encodeKey(x, 0, 0))).toBe(true)
    }
    expect(after.model.color.size).toBe(4)
    expect(after.past.length).toBe(3)
  })

  it('shift-lines repaint occupied cells with the active slot', () => {
    const s = useAppStore.getState()
    expect(s.paintLineAtCoord([1, 0, 0], false)).toBe(true)
    expect(s.paintLineAtCoord([2, 0, 0], false)).toBe(true)
    useAppStore.getState().setActivePaletteSlot(SLOT_B)
    expect(useAppStore.getState().paintLineAtCoord([0, 0, 0], false)).toBe(true)
    expect(useAppStore.getState().paintLineAtCoord([3, 0, 0], true)).toBe(true)

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(4)
    for (const x of [0, 1, 2, 3]) {
      expect(after.model.color.get(encodeKey(x, 0, 0))?.paletteSlot).toEqual(SLOT_B)
    }
  })

  it('a changed plane frame falls back to a single paint', () => {
    const s = useAppStore.getState()
    expect(s.paintLineAtCoord([0, 0, 0], false)).toBe(true)
    s.setPlaneAxisOrientation('x', 1)

    expect(useAppStore.getState().paintLineAtCoord([0, 0, 0], true)).toBe(true)
    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.paintLineAnchor).toEqual({ coord: [0, 0, 0], axis: 'x', orientation: 1 })
  })

  it('an off-slice target falls back to a single paint', () => {
    const s = useAppStore.getState()
    expect(s.paintLineAtCoord([0, 0, 0], false)).toBe(true)
    // z = 2 leaves the z/offset-0 slice — no in-plane line exists.
    expect(s.paintLineAtCoord([0, 1, 2], true)).toBe(true)

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(2)
    expect(after.model.color.has(encodeKey(0, 1, 2))).toBe(true)
  })

  it('same-cell shift-tap repaints once', () => {
    const s = useAppStore.getState()
    expect(s.paintLineAtCoord([0, 0, 0], false)).toBe(true)
    expect(s.paintLineAtCoord([0, 0, 0], true)).toBe(true)

    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(1)
    expect(after.paintLineAnchor?.coord).toEqual([0, 0, 0])
  })
})

/** 2D quadrant addressing of subdivided detail: paint/erase/material act on the hovered
 * set (front+back pair for 8-splits, fewer for partial splits); chamfer kinds write frozen
 * explicit shapes; the subdivide tool toggles through `toggleSubdivideCell`. z-plane
 * orientation 1 throughout, so display quadrant (0,0) is the (x-lo, y-hi) quarter:
 * front octant 6, back octant 2. */
describe('detail quadrants in 2D', () => {
  const SLOT_M = { kind: 'metal', index: 1 } as const
  const SLOT_B = { kind: 'base', index: 0 } as const
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setActiveVoxelKind('cube')
    useAppStore.getState().setActivePaletteSlot(SLOT_B)
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
    // The tests below subdivide without an explicit division — pin the default full
    // split instead of inheriting whatever a previous test left in the toolbar.
    useAppStore.getState().setPendingSplit(['x', 'y', 'z'])
  })

  function subdividedAt(u: number, v: number) {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(u, v)).toBe(true)
    s.commitStroke()
    const coord = gridCoordFromPixel(PLANE, u, v)
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord(coord)).toBe(true)
    s.commitStroke()
    return coord
  }

  it('toggles subdivision through toggleSubdivideCell', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -1)).toBe(true)
    s.commitStroke()
    s.beginStroke()
    expect(s.toggleSubdivideCell(0, -1)).toBe(true)
    s.commitStroke()
    let after = useAppStore.getState()
    expect(after.model.subdiv.has(encodeKey(0, 0, 0))).toBe(true)
    // Tapping a full split advances past the end → merges back to a cube.
    s.beginStroke()
    expect(s.toggleSubdivideCell(0, -1)).toBe(true)
    s.commitStroke()
    after = useAppStore.getState()
    expect(after.model.subdiv.has(encodeKey(0, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(true)
  })

  it('paints exactly the hovered front child, leaving the rest inherited', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    useAppStore.getState().setActivePaletteSlot(SLOT_M)
    s.beginStroke()
    expect(s.paintCell(0, -1, 0, 0)).toBe(true)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    // Quadrant (0,0) addresses [6, 2] front-sorted; whole-voxel mode paints the front one.
    expect(sub.children[6]).toEqual({ slot: SLOT_M })
    expect(sub.children[2]).toEqual({ slot: { kind: 'base', index: 0 } })
    for (let i = 0; i < 8; i++) {
      if (i === 6) continue
      expect(sub.children[i]).toEqual({ slot: { kind: 'base', index: 0 } })
    }
  })

  it('paints the front slab without a quadrant (shift-lines, synthetic events)', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    useAppStore.getState().setActivePaletteSlot(SLOT_M)
    s.beginStroke()
    expect(s.paintCell(0, -1)).toBe(true)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    // The viewer-side depth half (dz=1: children 4-7); the back half stays inherited.
    for (const o of [4, 5, 6, 7]) expect(sub.children[o]).toEqual({ slot: SLOT_M })
    for (const o of [0, 1, 2, 3]) expect(sub.children[o]).toEqual({ slot: { kind: 'base', index: 0 } })
  })

  it('erases content only, clearing the subdivision only when already empty', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    s.beginStroke()
    s.eraseCell([0, 0, 0], 0, 0)
    s.commitStroke()
    let sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    expect(sub.children[6]).toBeNull()
    expect(sub.children[2]).toBeNull()
    expect(sub.children.filter(Boolean)).toHaveLength(6)
    // Erase the other three quadrants: content gone, structure kept for repainting.
    s.beginStroke()
    s.eraseCell([0, 0, 0], 1, 0)
    s.eraseCell([0, 0, 0], 0, 1)
    s.eraseCell([0, 0, 0], 1, 1)
    s.commitStroke()
    const after = useAppStore.getState()
    expect(after.model.subdiv.has(encodeKey(0, 0, 0))).toBe(true)
    expect(after.model.subdiv.get(encodeKey(0, 0, 0))!.children.every((c) => c === null)).toBe(true)
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(false)
    // Erasing the already-empty voxel clears the subdivision.
    s.beginStroke()
    s.eraseCell([0, 0, 0], 0, 0)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.has(encodeKey(0, 0, 0))).toBe(false)
  })

  it('recolors the hovered pair only', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    useAppStore.getState().setActivePaletteSlot(SLOT_M)
    s.beginStroke()
    expect(s.paintMaterialCell(0, -1, 1, 1)).toBe(true)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    const changed = sub.children.map((c, i) => (c?.slot.kind === 'metal' ? i : -1)).filter((i) => i >= 0)
    expect(changed).toHaveLength(2)
    // The pair differs from quadrant (0,0)'s pair — different in-plane quarter.
    expect(new Set(changed)).not.toEqual(new Set([6, 2]))
    // Same-slot recolor is a no-op.
    s.beginStroke()
    expect(s.paintMaterialCell(0, -1, 1, 1)).toBe(false)
    s.commitStroke()
  })

  it('writes explicit kinds as frozen verbatim shapes, scaled at render', () => {
    subdividedAt(0, -1)
    useAppStore.getState().setActiveVoxelKind('convex')
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -1, 0, 0)).toBe(true)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    // The hovered quadrant's front child takes the frozen convex (verbatim kind + brush
    // rotation); the back child and the rest stay plain.
    expect(sub.children[6]).toEqual({
      slot: SLOT_B,
      chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'convex', rotation: 0 } },
    })
    expect(sub.children.filter((c) => c?.chamfer)).toHaveLength(1)
  })

  it('auto-bevels ramps from the subcell neighborhood (adjacent subdivided voxels included)', () => {
    subdividedAt(0, -1) // full split at (0,0,0), all base
    const s = useAppStore.getState()
    // North neighbor cube: child 6 (front-top-left) then sees N filled (the cube),
    // S filled (sibling child 4), E filled (sibling child 7), W open → ramp, open W.
    s.beginStroke()
    expect(s.paintCell(0, -2)).toBe(true) // (0,1,0): north of the parent
    s.commitStroke()
    useAppStore.getState().setActiveVoxelKind('ramp')
    s.beginStroke()
    expect(s.paintCell(0, -1, 0, 0)).toBe(true)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    // Open W (index 3) → rotation (3+3)%4 = 2, on the front child only.
    expect(sub.children[6]).toEqual({
      slot: SLOT_B,
      chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 2 } },
    })
    expect(sub.children[2]).toEqual({ slot: SLOT_B })
  })

  it('leaves ramps unresolved without neighbors, then resolves them on a later stroke', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    s.beginStroke()
    // Drop the east-half siblings so the stamped child sees a single filled neighbor.
    s.eraseCell([0, 0, 0], 1, 0) // quadrant (1,0) → children [7, 3]
    s.eraseCell([0, 0, 0], 1, 1) // quadrant (1,1) → children [5, 1]
    s.commitStroke()
    useAppStore.getState().setActiveVoxelKind('ramp')
    s.beginStroke()
    expect(s.paintCell(0, -1, 0, 0)).toBe(true)
    s.commitStroke()
    // One filled neighbor (S sibling) is not a bevel: null (renders as a cube).
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]).toEqual({
      slot: SLOT_B,
      chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: null },
    })
    // A later stroke paints the N+W cubes; the stroke-end pass completes the ramp
    // (N+S+W filled, E open → rotation (1+3)%4 = 0).
    useAppStore.getState().setActiveVoxelKind('cube')
    s.beginStroke()
    expect(s.paintCell(0, -2)).toBe(true) // (0,1,0): north
    expect(s.paintCell(-1, -1)).toBe(true) // (-1,0,0): west
    s.correctChamferStroke()
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    expect(sub.children[6]?.chamfer?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 0 })
  })

  it('auto-bevels wedges from convex corners, falling back to rotation 0', () => {
    subdividedAt(0, -1)
    // Clear the S/E sibling support so only N (painted below) and E read filled.
    const s = useAppStore.getState()
    s.beginStroke()
    s.eraseCell([0, 0, 0], 0, 1) // quadrant (0,1) → children [4, 0]
    expect(s.paintCell(0, -2)).toBe(true) // north cube
    s.commitStroke()
    useAppStore.getState().setActiveVoxelKind('wedge')
    s.beginStroke()
    expect(s.paintCell(0, -1, 0, 0)).toBe(true)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    // N+E filled = the [0,1] adjacent pair → corner 2.
    expect(sub.children[6]).toEqual({
      slot: SLOT_B,
      chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'wedge', rotation: 2 } },
    })
  })

  it('wedges wait at rotation 0 until the stroke completes their corner', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    s.beginStroke()
    s.eraseCell([0, 0, 0], 0, 1) // drop S support: N/E/S/W read empty
    s.commitStroke()
    useAppStore.getState().setActiveVoxelKind('wedge')
    s.beginStroke()
    expect(s.paintCell(0, -1, 0, 0)).toBe(true)
    // Fallback: no convex corner yet.
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]).toEqual({
      slot: SLOT_B,
      chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'wedge', rotation: 0 } },
    })
    // Completing the corner in the same stroke upgrades it at stroke end.
    useAppStore.getState().setActiveVoxelKind('cube')
    expect(s.paintCell(0, -2)).toBe(true) // north cube → N+E convex
    s.correctChamferStroke()
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]).toEqual({
      slot: SLOT_B,
      chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'wedge', rotation: 2 } },
    })
  })

  it('3D per-child taps auto-bevel from the subcell neighborhood', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -2)).toBe(true) // north cube
    s.commitStroke()
    useAppStore.getState().setActiveVoxelKind('ramp')
    s.beginStroke()
    expect(s.paintSubCellAtCoord([0, 0, 0], 6)).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]).toEqual({
      slot: SLOT_B,
      chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 2 } },
    })
  })

  it('2D re-clicks rotate detail bevels, then advance the family past a full turn', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -2)).toBe(true) // north cube → child 6 sees N+S+E filled
    s.commitStroke()
    useAppStore.getState().setActiveVoxelKind('ramp')
    const stamp = () => {
      s.beginStroke()
      expect(s.paintCell(0, -1, 0, 0)).toBe(true)
      s.commitStroke()
    }
    stamp() // fresh auto-bevel: ramp, open W → rotation 2
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]!.chamfer!.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 2 })
    stamp() // re-click: rotate to 3
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]!.chamfer!.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 3 })
    stamp() // completing the turn advances to convex instead of wrapping to 0
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]!.chamfer!.resolvedTo).toEqual({ shapeKind: 'convex', rotation: 0 })
  })

  it('drag revisits do not advance detail bevels mid-stroke', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -2)).toBe(true) // north cube
    s.commitStroke()
    useAppStore.getState().setActiveVoxelKind('ramp')
    s.beginStroke()
    expect(s.paintCell(0, -1, 0, 0)).toBe(true) // fresh: ramp@2
    expect(s.paintCell(0, -1, 0, 0)).toBe(true) // same-stroke revisit: untouched
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]!.chamfer!.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 2 })
  })

  it('3D re-clicks cycle detail bevels like 2D taps', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -2)).toBe(true) // north cube
    s.commitStroke()
    useAppStore.getState().setActiveVoxelKind('ramp')
    s.beginStroke()
    expect(s.paintSubCellAtCoord([0, 0, 0], 6)).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]!.chamfer!.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 2 })
    s.beginStroke()
    expect(s.paintSubCellAtCoord([0, 0, 0], 6)).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]!.chamfer!.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 3 })
  })

  it('subdivides with an explicit split (u-split → 2 children)', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -1)).toBe(true)
    s.commitStroke()
    s.setPendingSplit(['x'])
    s.beginStroke()
    expect(s.toggleSubdivideCell(0, -1)).toBe(true)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    expect(sub.split).toEqual(['x'])
    expect(sub.children).toHaveLength(2)
    // Painting one quadrant of a u-split addresses the matching half (both qv map to it).
    useAppStore.getState().setActivePaletteSlot(SLOT_M)
    s.beginStroke()
    expect(s.paintCell(0, -1, 1, 0)).toBe(true)
    s.commitStroke()
    const after = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    expect(after.children[1]).toEqual({ slot: SLOT_M })
    expect(after.children[0]).toEqual({ slot: SLOT_B })
  })

  it('flood fill treats subdivided cells as occupied boundaries (never paints them)', () => {
    // Enclosed 3x3 ring at z=0 with a subdivided cell inside the empty middle.
    const s = useAppStore.getState()
    s.beginStroke()
    for (const [u, v] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      s.paintCell(u, v)
    }
    s.commitStroke()
    const mid = gridCoordFromPixel(PLANE, 0, 0)
    s.beginStroke()
    expect(s.paintCell(0, 0)).toBe(true)
    s.commitStroke()
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord(mid)).toBe(true)
    s.commitStroke()
    // Filling from inside the ring: the flood stops at the subdivided cell (no color there
    // to match, and it blocks traversal), so nothing paints.
    s.beginStroke()
    s.floodFill(0, 0)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(...mid))!
    expect(sub.children.every((c) => c?.slot.kind === 'base')).toBe(true)
  })
})

describe('subdivision advance cycling and pending splits', () => {
  const SLOT_M = { kind: 'metal', index: 1 } as const
  const SLOT_B = { kind: 'base', index: 0 } as const
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setActiveVoxelKind('cube')
    useAppStore.getState().setActivePaletteSlot(SLOT_B)
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
    useAppStore.getState().setPendingSplit(['x', 'y', 'z'])
  })

  function subdividedAt(u: number, v: number, pending?: SplitAxis[] | null) {
    if (pending !== undefined) useAppStore.getState().setPendingSplit(pending)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(u, v)).toBe(true)
    s.commitStroke()
    const coord = gridCoordFromPixel(PLANE, u, v)
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord(coord)).toBe(true)
    s.commitStroke()
    return coord
  }

  it('splits with the pending division and adopts it', () => {
    useAppStore.getState().setPendingSplit(['z'])
    subdividedAt(0, -1)
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['z'])
    expect(useAppStore.getState().pendingSplit).toEqual(['z'])
  })

  it('plain taps with no pending division toast a hint and change nothing', () => {
    useAppStore.getState().setPendingSplit(null)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -1)).toBe(true)
    s.commitStroke()
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord(gridCoordFromPixel(PLANE, 0, -1))).toBe(false)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.size).toBe(0)
  })

  it('scaffolds empty space with the pending division and active slot', () => {
    useAppStore.getState().setPendingSplit(['x', 'y'])
    useAppStore.getState().setActivePaletteSlot(SLOT_M)
    const coord = gridCoordFromPixel(PLANE, 2, 2)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord(coord)).toBe(true)
    s.commitStroke()
    const after = useAppStore.getState()
    const sub = after.model.subdiv.get(encodeKey(...coord))!
    expect(sub.scaffold).toBe(true)
    expect(sub.split).toEqual(['x', 'y'])
    expect(sub.slot).toEqual(SLOT_M)
    expect(sub.children.every((c) => c === null)).toBe(true)
    expect(after.model.color.has(encodeKey(...coord))).toBe(false)
    expect(after.pendingSplit).toEqual(['x', 'y'])
  })

  it('empty taps with no pending division toast a hint and change nothing', () => {
    useAppStore.getState().setPendingSplit(null)
    const coord = gridCoordFromPixel(PLANE, 2, 2)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord(coord)).toBe(false)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.size).toBe(0)
  })

  it('a scaffold paints per-child, then tapping past the end clears it', () => {
    useAppStore.getState().setPendingSplit(['x', 'y', 'z'])
    const s = useAppStore.getState()
    const coord = gridCoordFromPixel(PLANE, 0, -1)
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord(coord)).toBe(true)
    s.commitStroke()
    // Paint one octant through the quadrant path.
    s.beginStroke()
    expect(s.paintCell(0, -1, 1, 1)).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(...coord))!.children.some((c) => c !== null)).toBe(true)
    // A full split advances straight past the end — the scaffold vanishes, no cube appears.
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord(coord)).toBe(true)
    s.commitStroke()
    const after = useAppStore.getState()
    expect(after.model.subdiv.has(encodeKey(...coord))).toBe(false)
    expect(after.model.color.has(encodeKey(...coord))).toBe(false)
  })

  it('Alt forces the full split regardless of pending', () => {
    useAppStore.getState().setPendingSplit(['x'])
    subdividedAt(0, -1)
    const after = useAppStore.getState()
    expect(after.model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['x'])
    // Alt on an already-subdivided cell re-splits to full.
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord([0, 0, 0], true)).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['x', 'y', 'z'])
  })

  it('taps cycle within the voxel family without touching the toolbar, then merge past the end', () => {
    subdividedAt(0, -1, ['x'])
    const s = useAppStore.getState()
    // x → y → z; the toolbar keeps its division (no axis state in the tool).
    for (const want of [['y'], ['z']]) {
      s.beginStroke()
      expect(s.toggleSubdivideAtCoord([0, 0, 0])).toBe(true)
      s.commitStroke()
      expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(want)
    }
    expect(useAppStore.getState().pendingSplit).toEqual(['x'])
    // Past the end of the family → merge back to a cube.
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord([0, 0, 0])).toBe(true)
    s.commitStroke()
    const after = useAppStore.getState()
    expect(after.model.subdiv.has(encodeKey(0, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(true)
    // The next plain tap splits with the unchanged toolbar division — the cycle restarts.
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord([0, 0, 0])).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['x'])
  })

  it('taps cycle the voxel family even when the toolbar names another one, and whole merges back', () => {
    subdividedAt(0, -1, ['x'])
    // A different toolbar family does NOT divert the cycle — taps follow voxel state.
    useAppStore.getState().setPendingSplit(['x', 'y'])
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord([0, 0, 0])).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['y'])
    expect(useAppStore.getState().pendingSplit).toEqual(['x', 'y'])
    // Whole mode (nothing selected) merges back to a cube.
    useAppStore.getState().setPendingSplit(null)
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord([0, 0, 0])).toBe(true)
    s.commitStroke()
    const after = useAppStore.getState()
    expect(after.model.subdiv.has(encodeKey(0, 0, 0))).toBe(false)
    expect(after.model.color.has(encodeKey(0, 0, 0))).toBe(true)
  })

  it('plain splits adopt the toolbar division, and taps cycle without adopting', () => {
    expect(useAppStore.getState().pendingSplit).toEqual(['x', 'y', 'z'])
    subdividedAt(0, -1, ['y'])
    expect(useAppStore.getState().pendingSplit).toEqual(['y'])
    // Tapping advances within the family but leaves the toolbar alone.
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord([0, 0, 0])).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['z'])
    expect(useAppStore.getState().pendingSplit).toEqual(['y'])
    // Alt forces full as a momentary override — the toolbar keeps its division.
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord([0, 0, 0], true)).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['x', 'y', 'z'])
    expect(useAppStore.getState().pendingSplit).toEqual(['y'])
  })

  it('explicit re-split replaces the division and preserves content by overlap', () => {
    subdividedAt(0, -1, ['x'])
    // Paint the x-high half metal.
    useAppStore.getState().setActivePaletteSlot(SLOT_M)
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(0, -1, 1, 0)).toBe(true)
    s.commitStroke()
    // Alt-style explicit re-split to 8: the metal half's volume maps onto its octants.
    s.beginStroke()
    expect(s.toggleSubdivideAtCoord([0, 0, 0], true)).toBe(true)
    s.commitStroke()
    const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
    expect(sub.split).toEqual(['x', 'y', 'z'])
    const metal = sub.children.map((c, i) => (c?.slot.kind === 'metal' ? i : -1)).filter((i) => i >= 0)
    // The x-high half covers octants with dx=1: 1, 3, 5, 7 (overlap remap preserves by
    // volume — the front-most paint rule applies to taps, not to content migration).
    expect(metal).toEqual([1, 3, 5, 7])
  })

  it('3D per-child edits always work (no scope gates)', () => {
    subdividedAt(0, -1)
    const s = useAppStore.getState()
    useAppStore.getState().setActivePaletteSlot(SLOT_M)
    s.beginStroke()
    expect(s.paintSubCellAtCoord([0, 0, 0], 6)).toBe(true)
    s.commitStroke()
    expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.children[6]).toEqual({ slot: SLOT_M })
  })

  describe('half-step slab editing', () => {
    beforeEach(() => {
      useAppStore.getState().setPlaneHalf(null)
    })

    it('paints only the active slab of a subdivided voxel, refusing plain cubes', () => {
      subdividedAt(0, -1) // full 8-way split at (0,0,0), base slots
      useAppStore.getState().setPlaneHalf(1)
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      const s = useAppStore.getState()
      s.beginStroke()
      s.paintCell(2, 2) // plain cube — refused silently
      // Quadrant (0,0) addresses children [6, 2] (front-sorted); slab 1 keeps only 6.
      expect(s.paintCell(0, -1, 0, 0)).toBe(true)
      s.commitStroke()
      const after = useAppStore.getState()
      expect(after.model.color.has(keyFor(2, 2))).toBe(false)
      const sub = after.model.subdiv.get(encodeKey(0, 0, 0))!
      expect(sub.children[6]).toEqual({ slot: SLOT_M })
      expect(sub.children[2]).toEqual({ slot: SLOT_B })
    })

    it('erases only the active slab, refusing plain cubes', () => {
      subdividedAt(0, -1)
      // Seed a plain cube elsewhere in whole-voxel mode first.
      const s = useAppStore.getState()
      s.beginStroke()
      expect(s.paintCell(2, 2)).toBe(true)
      s.commitStroke()
      useAppStore.getState().setPlaneHalf(1)
      s.beginStroke()
      s.eraseCell(gridCoordFromPixel(PLANE, 2, 2)) // plain — refused
      s.eraseCell([0, 0, 0], 0, 0) // quadrant (0,0) → children [6, 2], slab 1 erases 6 only
      s.commitStroke()
      const after = useAppStore.getState()
      expect(after.model.color.has(keyFor(2, 2))).toBe(true)
      const sub = after.model.subdiv.get(encodeKey(0, 0, 0))!
      expect(sub.children[6]).toBeNull()
      expect(sub.children[2]).not.toBeNull()
    })

    it('recolors only the active slab, refusing plain cubes', () => {
      subdividedAt(0, -1)
      const s = useAppStore.getState()
      s.beginStroke()
      expect(s.paintCell(2, 2)).toBe(true)
      s.commitStroke()
      useAppStore.getState().setPlaneHalf(0)
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      s.beginStroke()
      expect(s.paintMaterialCell(2, 2)).toBe(false)
      expect(s.paintMaterialCell(0, -1, 0, 0)).toBe(true)
      s.commitStroke()
      const after = useAppStore.getState()
      expect(after.model.color.get(keyFor(2, 2))).toEqual({ paletteSlot: SLOT_B })
      const sub = after.model.subdiv.get(encodeKey(0, 0, 0))!
      // Slab 0 keeps the depth-back child 2; the front child 6 is untouched.
      expect(sub.children[2]).toEqual({ slot: SLOT_M })
      expect(sub.children[6]).toEqual({ slot: SLOT_B })
    })

    it('refuses splitting and scaffolding, but advances subdivided cells', () => {
      subdividedAt(0, -1, ['x'])
      useAppStore.getState().setPlaneHalf(1)
      const s = useAppStore.getState()
      s.beginStroke()
      expect(s.toggleSubdivideAtCoord(gridCoordFromPixel(PLANE, 2, 2))).toBe(false)
      // Same family → advance within the family.
      expect(s.toggleSubdivideAtCoord([0, 0, 0])).toBe(true)
      s.commitStroke()
      expect(useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['y'])
      // A different toolbar family does NOT divert the cycle on half-step either.
      useAppStore.getState().setPendingSplit(['y', 'z'])
      s.beginStroke()
      expect(s.toggleSubdivideAtCoord([0, 0, 0])).toBe(true)
      s.commitStroke()
      const after = useAppStore.getState()
      expect(after.model.subdiv.has(keyFor(2, 2))).toBe(false)
      expect(after.model.subdiv.get(encodeKey(0, 0, 0))!.split).toEqual(['z'])
    })

    it('3D per-child writes clip to the slab and the slice', () => {
      subdividedAt(0, -1) // full split at (0,0,0)
      useAppStore.getState().setPlaneHalf(1)
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      const s = useAppStore.getState()
      s.beginStroke()
      expect(s.paintSubCellAtCoord([0, 0, 0], 2)).toBe(false) // depth-back child
      expect(s.paintSubCellAtCoord([0, 0, 0], 6)).toBe(true) // depth-front child
      s.commitStroke()
      // Off-slice parents refuse even in-slab children (dwell on the active slice).
      useAppStore.getState().setPlaneOffset(5)
      s.beginStroke()
      expect(s.paintSubCellAtCoord([0, 0, 0], 6)).toBe(false)
      s.commitStroke()
      const sub = useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))!
      expect(sub.children[6]).toEqual({ slot: SLOT_M })
      expect(sub.children[2]).toEqual({ slot: SLOT_B })
    })

    it('fillSelection refuses on half-step', () => {
      const s = useAppStore.getState()
      s.beginStroke()
      expect(s.paintCell(2, 2)).toBe(true)
      s.commitStroke()
      s.setSelectedCells(new Set([keyFor(2, 2)]))
      useAppStore.getState().setPlaneHalf(1)
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      s.fillSelection()
      expect(useAppStore.getState().model.color.get(keyFor(2, 2))).toEqual({ paletteSlot: SLOT_B })
    })
  })
})
