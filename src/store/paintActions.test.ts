import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
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
 * explicit shapes; the grid picker arms the just-in-time division (whole paints whole
 * voxels, halves/quarters/octal split fresh cells on first paint). z-plane
 * orientation 1 throughout, so display quadrant (0,0) is the (x-lo, y-hi) quarter:
 * front octant 6, back octant 2. */
/**
 * Sub-voxel editing through the grid. On the z/1 plane at offset 0: pixel (0,-1) is voxel
 * (0,0,0), logical u runs +x and v runs -y, so logical quadrant (qu, qv) is world x = qu,
 * y = 1 - qv. With the grid cutting z the plane sits on a half stop — the viewer-side high-z
 * slab — and child indices are x + 2y + 4z on a full split (quadrant (0,0) front = child 6).
 */
describe('grid-resolution editing (writeBox)', () => {
  const SLOT_M = { kind: 'metal', index: 1 } as const
  const SLOT_B = { kind: 'base', index: 0 } as const
  const sub0 = () => useAppStore.getState().model.subdiv.get(encodeKey(0, 0, 0))
  const stroke = (fn: (s: ReturnType<typeof useAppStore.getState>) => void) => {
    const s = useAppStore.getState()
    s.beginStroke()
    fn(s)
    s.commitStroke()
  }
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setActiveVoxelKind('cube')
    useAppStore.getState().setActivePaletteSlot(SLOT_B)
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
    useAppStore.getState().setGridSplit(['x', 'y', 'z'])
  })

  /** Paints the front slab of (0,0,0) with the full grid armed (no pointer half: full in-plane). */
  function frontSlab() {
    stroke((s) => expect(s.paintCell(0, -1)).toBe(true))
  }

  describe('the grid is the control', () => {
    it('whole grid paints whole voxels; an armed grid paints one grid cell', () => {
      useAppStore.getState().setGridDivision('whole')
      stroke((s) => expect(s.paintCell(0, -1, 0, 0)).toBe(true))
      expect(useAppStore.getState().model.color.has(encodeKey(0, 0, 0))).toBe(true)
      expect(useAppStore.getState().model.subdiv.size).toBe(0)
      useAppStore.getState().setGridDivision('half') // ['x'], doesn't cut z: no half stop
      expect(useAppStore.getState().plane.half).toBeNull()
      stroke((s) => expect(s.paintCell(2, -1, 1, 0)).toBe(true))
      expect(useAppStore.getState().model.subdiv.get(encodeKey(2, 0, 0))).toEqual({ split: ['x'], children: [null, { slot: SLOT_B }] })
    })

    it('paints exactly the hovered grid cell on the plane slab', () => {
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      stroke((s) => expect(s.paintCell(0, -1, 0, 0)).toBe(true))
      const sub = sub0()!
      expect(sub.split).toEqual(['x', 'y', 'z'])
      expect(sub.children[6]).toEqual({ slot: SLOT_M })
      expect(sub.children.filter((c) => c !== null)).toHaveLength(1)
    })

    it('without a pointer half the write spans the in-plane extent at the plane slab', () => {
      frontSlab()
      expect(sub0()).toEqual({ split: ['z'], children: [null, { slot: SLOT_B }] })
    })

    it('the whole grid replaces detail with one voxel', () => {
      stroke((s) => s.paintCell(0, -1, 0, 0))
      useAppStore.getState().setGridDivision('whole')
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      stroke((s) => s.paintCell(0, -1, 1, 1))
      expect(sub0()).toBeUndefined()
      expect(useAppStore.getState().model.color.get(encodeKey(0, 0, 0))).toEqual({ paletteSlot: SLOT_M })
    })

    it('the armed grid wins over a voxel’s existing split (it re-splits, keeping detail)', () => {
      useAppStore.getState().setGridSplit(['y'])
      stroke((s) => s.paintCell(0, -1, 0, 0)) // y-high half
      expect(sub0()!.split).toEqual(['y'])
      useAppStore.getState().setGridSplit(['x'])
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      stroke((s) => s.paintCell(0, -1, 1, 0)) // x-high half
      const sub = sub0()!
      expect(sub.split).toEqual(['x', 'y'])
      // x-high is all M; x-low keeps its y-high B and y-low hole.
      expect(sub.children).toEqual([null, { slot: SLOT_M }, { slot: SLOT_B }, { slot: SLOT_M }])
    })

    it('uniform paint folds back to a plain voxel (no redundant subdivision)', () => {
      useAppStore.getState().setGridSplit(null)
      stroke((s) => s.paintCell(0, -1))
      useAppStore.getState().setGridSplit(['x'])
      stroke((s) => {
        s.paintCell(0, -1, 0, 0)
        s.paintCell(0, -1, 1, 0)
      })
      expect(sub0()).toBeUndefined()
      expect(useAppStore.getState().model.color.get(encodeKey(0, 0, 0))).toEqual({ paletteSlot: SLOT_B })
    })

    it('painting both slabs of a voxel folds it whole', () => {
      frontSlab()
      useAppStore.getState().stepPlaneHalf(-1) // high slab → low slab of the same layer
      expect(useAppStore.getState().plane).toMatchObject({ offset: 0, half: 0 })
      frontSlab()
      expect(sub0()).toBeUndefined()
      expect(useAppStore.getState().model.color.has(encodeKey(0, 0, 0))).toBe(true)
    })

    it('setGridDivision arms families and re-clicks cycle them globally', () => {
      const after = () => useAppStore.getState()
      after().setGridDivision('whole')
      after().setGridDivision('half')
      expect(after().gridSplit).toEqual(['x'])
      after().setGridDivision('half')
      expect(after().gridSplit).toEqual(['y'])
      after().setGridDivision('half')
      expect(after().gridSplit).toEqual(['z'])
      after().setGridDivision('half')
      expect(after().gridSplit).toEqual(['x'])
      after().setGridDivision('quarter')
      expect(after().gridSplit).toEqual(['y', 'z'])
      after().setGridDivision('quarter')
      expect(after().gridSplit).toEqual(['x', 'z'])
      after().setGridDivision('quarter')
      expect(after().gridSplit).toEqual(['x', 'y'])
      after().setGridDivision('octal')
      expect(after().gridSplit).toEqual(['x', 'y', 'z'])
      after().setGridDivision('octal')
      expect(after().gridSplit).toEqual(['x', 'y', 'z'])
      after().setGridDivision('whole')
      expect(after().gridSplit).toBeNull()
    })
  })

  describe('erase and recolor use the same box', () => {
    it('erases half of a plain voxel when the grid cuts the plane axis', () => {
      useAppStore.getState().setGridSplit(null)
      stroke((s) => s.paintCell(0, -1))
      useAppStore.getState().setGridSplit(['z'])
      expect(useAppStore.getState().plane.half).toBe(1)
      stroke((s) => s.eraseCell([0, 0, 0]))
      expect(sub0()).toEqual({ split: ['z'], children: [{ slot: SLOT_B }, null] })
      // Erasing the other half deletes the voxel outright.
      useAppStore.getState().setPlaneHalf(0)
      stroke((s) => s.eraseCell([0, 0, 0]))
      expect(sub0()).toBeUndefined()
      expect(useAppStore.getState().model.color.has(encodeKey(0, 0, 0))).toBe(false)
    })

    it('erases one grid cell under the quadrant; the whole grid erases the whole voxel', () => {
      useAppStore.getState().setGridSplit(['x'])
      stroke((s) => s.paintCell(0, -1))
      stroke((s) => s.eraseCell([0, 0, 0], 1, 0))
      expect(sub0()).toEqual({ split: ['x'], children: [{ slot: SLOT_B }, null] })
      useAppStore.getState().setGridSplit(null)
      stroke((s) => s.eraseCell([0, 0, 0], 0, 0))
      expect(sub0()).toBeUndefined()
      expect(useAppStore.getState().model.color.size).toBe(0)
    })

    it('3D erase carves the grid cell under the clicked point', () => {
      useAppStore.getState().setGridSplit(null)
      stroke((s) => s.paintCell(0, -1))
      useAppStore.getState().setGridSplit(['y'])
      stroke((s) => s.eraseCellAtCoord([0, 0, 0], [0, 1, 0]))
      expect(sub0()).toEqual({ split: ['y'], children: [{ slot: SLOT_B }, null] })
    })

    it('recolors only the hovered grid cell, never adding volume', () => {
      useAppStore.getState().setGridSplit(null)
      stroke((s) => s.paintCell(0, -1))
      useAppStore.getState().setGridSplit(['x'])
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      let changed = false
      stroke((s) => {
        changed = s.paintMaterialCell(0, -1, 1, 0)
        expect(s.paintMaterialCell(5, 5, 0, 0)).toBe(false) // empty: nothing to recolor
      })
      expect(changed).toBe(true)
      expect(sub0()).toEqual({ split: ['x'], children: [{ slot: SLOT_B }, { slot: SLOT_M }] })
      expect(useAppStore.getState().model.color.has(keyFor(5, 5))).toBe(false)
    })

    it('recolor never cuts a bevel: a chamfer voxel recolors whole', () => {
      useAppStore.getState().setGridSplit(null)
      useAppStore.getState().setActiveVoxelKind('convex')
      stroke((s) => s.paintCell(0, -1))
      useAppStore.getState().setGridSplit(['x'])
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      stroke((s) => expect(s.paintMaterialCell(0, -1, 1, 0)).toBe(true))
      const m = useAppStore.getState().model
      expect(m.subdiv.size).toBe(0)
      expect(m.color.get(encodeKey(0, 0, 0))).toEqual({ paletteSlot: SLOT_M })
      expect(m.chamfer.get(encodeKey(0, 0, 0))?.resolvedTo?.shapeKind).toBe('convex')
    })
  })

  describe('fills', () => {
    it('3D volume fill is material-only: bevels survive, nothing subdivides', () => {
      useAppStore.getState().setGridSplit(null)
      useAppStore.getState().setActiveVoxelKind('convex')
      stroke((s) => s.paintCell(0, -1))
      useAppStore.getState().setGridSplit(['x', 'y', 'z'])
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      useAppStore.getState().floodFillCellsAt([0, 0, 0], false)
      const m = useAppStore.getState().model
      expect(m.subdiv.size).toBe(0)
      expect(m.chamfer.get(encodeKey(0, 0, 0))?.resolvedTo?.shapeKind).toBe('convex')
      expect(m.color.get(encodeKey(0, 0, 0))).toEqual({ paletteSlot: SLOT_M })
    })

    it('3D fill on a subdivided voxel recolors the grid cell tapped (it is occupied, not empty space)', () => {
      stroke((s) => s.paintCell(0, -1, 0, 0))
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      // The tap lands on child 6's surface: world bits x0 y1 z1.
      useAppStore.getState().floodFillCellsAt([0, 0, 0], false, [0, 1, 1])
      expect(sub0()!.children[6]).toEqual({ slot: SLOT_M })
      expect(useAppStore.getState().model.color.size).toBe(0)
    })

    it('selection fill writes the grid depth: the plane slab under a depth cut, whole otherwise', () => {
      useAppStore.getState().setSelection({ originU: 0, originV: -1, width: 1, height: 1, mask: new Uint8Array([1]) })
      useAppStore.getState().fillSelection()
      expect(sub0()).toEqual({ split: ['z'], children: [null, { slot: SLOT_B }] })
      useAppStore.getState().setGridSplit(['x'])
      useAppStore.getState().setSelection({ originU: 0, originV: -1, width: 1, height: 1, mask: new Uint8Array([1]) })
      useAppStore.getState().fillSelection()
      expect(sub0()).toBeUndefined()
      expect(useAppStore.getState().model.color.has(encodeKey(0, 0, 0))).toBe(true)
    })

    it('flood fill runs at grid resolution: an empty half of a split voxel fills like any grid cell', () => {
      useAppStore.getState().setGridSplit(null)
      stroke((s) => {
        for (const [u, v] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) s.paintCell(u, v)
      })
      const mid = gridCoordFromPixel(PLANE, 0, 0)
      useAppStore.getState().setGridSplit(['x'])
      stroke((s) => s.paintCell(0, 0, 1, 0)) // x-high half of the middle
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      // Click the empty x-low half: only that grid cell is enclosed (ring + the B half).
      stroke((s) => s.floodFill(0, 0, 0, 0))
      expect(useAppStore.getState().model.subdiv.get(encodeKey(...mid))!.children).toEqual([{ slot: SLOT_M }, { slot: SLOT_B }])
      expect(useAppStore.getState().model.color.get(encodeKey(...gridCoordFromPixel(PLANE, -1, 0)))?.paletteSlot).toEqual(SLOT_B)
    })

    it('a filled half is a wall to an empty fill, and a color fill follows it at grid resolution', () => {
      useAppStore.getState().setGridSplit(['x'])
      // Two B halves side by side across a voxel boundary: (0,0) x-high and (1,0) x-low.
      stroke((s) => {
        s.paintCell(0, 0, 1, 0)
        s.paintCell(1, 0, 0, 0)
      })
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      // Color fill from (0,0)'s x-high half takes exactly the connected B halves.
      stroke((s) => s.floodFill(0, 0, 1, 0))
      const m = useAppStore.getState().model
      expect(m.subdiv.get(encodeKey(...gridCoordFromPixel(PLANE, 0, 0)))!.children).toEqual([null, { slot: SLOT_M }])
      expect(m.subdiv.get(encodeKey(...gridCoordFromPixel(PLANE, 1, 0)))!.children).toEqual([{ slot: SLOT_M }, null])
    })

    it('volume fill (Alt) follows the grid through split voxels', () => {
      useAppStore.getState().setGridSplit(['x'])
      stroke((s) => {
        s.paintCell(0, 0, 1, 0)
        s.paintCell(1, 0, 0, 0)
        s.paintCell(3, 0, 0, 0) // not connected
      })
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      useAppStore.getState().floodFill3D(0, 0, 1, 0)
      const m = useAppStore.getState().model
      expect(m.subdiv.get(encodeKey(...gridCoordFromPixel(PLANE, 1, 0)))!.children).toEqual([{ slot: SLOT_M }, null])
      expect(m.subdiv.get(encodeKey(...gridCoordFromPixel(PLANE, 3, 0)))!.children).toEqual([{ slot: SLOT_B }, null])
    })
  })

  describe('bevels in grid cells', () => {
    it('writes explicit kinds as frozen verbatim shapes in exactly the box', () => {
      frontSlab()
      useAppStore.getState().setActiveVoxelKind('convex')
      stroke((s) => expect(s.paintCell(0, -1, 0, 0)).toBe(true))
      const sub = sub0()!
      expect(sub.children[6]).toEqual({
        slot: SLOT_B,
        chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'convex', rotation: 0 } },
      })
      expect(sub.children.filter((c) => c?.chamfer)).toHaveLength(1)
    })

    it('auto-bevels ramps from the subcell neighborhood', () => {
      frontSlab()
      useAppStore.getState().setGridSplit(null)
      stroke((s) => expect(s.paintCell(0, -2)).toBe(true)) // north cube (0,1,0)
      useAppStore.getState().setGridSplit(['x', 'y', 'z'])
      useAppStore.getState().setActiveVoxelKind('ramp')
      stroke((s) => expect(s.paintCell(0, -1, 0, 0)).toBe(true))
      const sub = sub0()!
      // N (cube) + S, E (front siblings) filled, W open → rotation 2, on the front child only.
      expect(sub.children[6]).toEqual({
        slot: SLOT_B,
        chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 2 } },
      })
      expect(sub.children[2]).toBeNull()
    })

    it('an unresolved detail ramp resolves only on its own edit, never from later neighbors', () => {
      frontSlab()
      stroke((s) => {
        s.eraseCell([0, 0, 0], 1, 0) // child 7
        s.eraseCell([0, 0, 0], 1, 1) // child 5
      })
      useAppStore.getState().setActiveVoxelKind('ramp')
      stroke((s) => expect(s.paintCell(0, -1, 0, 0)).toBe(true))
      expect(sub0()!.children[6]?.chamfer?.resolvedTo).toBeNull()
      // A later stroke paints N + W: the ramp is not touched (no neighbor propagation).
      useAppStore.getState().setGridSplit(null)
      useAppStore.getState().setActiveVoxelKind('cube')
      stroke((s) => {
        s.paintCell(0, -2)
        s.paintCell(-1, -1)
        s.correctChamferStroke()
      })
      expect(sub0()!.children[6]?.chamfer?.resolvedTo).toBeNull()
      // Editing it resolves it: N + S + W filled, E open → rotation 0.
      useAppStore.getState().setGridSplit(['x', 'y', 'z'])
      useAppStore.getState().setActiveVoxelKind('ramp')
      stroke((s) => s.paintCell(0, -1, 0, 0))
      expect(sub0()!.children[6]?.chamfer?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 0 })
    })

    it('wedges wait at rotation 0 until the same stroke completes their corner', () => {
      frontSlab()
      stroke((s) => s.eraseCell([0, 0, 0], 0, 1)) // child 4: drop S support
      useAppStore.getState().setActiveVoxelKind('wedge')
      const s = useAppStore.getState()
      s.beginStroke()
      expect(s.paintCell(0, -1, 0, 0)).toBe(true)
      expect(sub0()!.children[6]?.chamfer?.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: 0 })
      useAppStore.getState().setGridSplit(null)
      useAppStore.getState().setActiveVoxelKind('cube')
      expect(s.paintCell(0, -2)).toBe(true) // north cube → N+E convex
      s.correctChamferStroke()
      s.commitStroke()
      expect(sub0()!.children[6]?.chamfer?.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: 2 })
    })

    it('3D taps place detail bevels in the pointer’s grid cell', () => {
      frontSlab()
      useAppStore.getState().setGridSplit(null)
      stroke((s) => s.paintCell(0, -2))
      useAppStore.getState().setGridSplit(['x', 'y', 'z'])
      useAppStore.getState().setActiveVoxelKind('ramp')
      stroke((s) => expect(s.paintCellAtCoord([0, 0, 0], 'z', 1, [0, 1, 0])).toBe(true))
      expect(sub0()!.children[6]?.chamfer?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 2 })
    })

    it('re-clicks rotate detail bevels, then advance the family past a full turn', () => {
      frontSlab()
      useAppStore.getState().setGridSplit(null)
      stroke((s) => s.paintCell(0, -2))
      useAppStore.getState().setGridSplit(['x', 'y', 'z'])
      useAppStore.getState().setActiveVoxelKind('ramp')
      const shape = () => sub0()!.children[6]!.chamfer!.resolvedTo
      stroke((s) => s.paintCell(0, -1, 0, 0))
      expect(shape()).toEqual({ shapeKind: 'ramp', rotation: 2 })
      stroke((s) => s.paintCell(0, -1, 0, 0))
      expect(shape()).toEqual({ shapeKind: 'ramp', rotation: 3 })
      stroke((s) => s.paintCellAtCoord([0, 0, 0], 'z', 1, [0, 1, 0])) // 3D re-click cycles too
      expect(shape()).toEqual({ shapeKind: 'convex', rotation: 0 })
    })

    it('drag revisits do not advance detail bevels mid-stroke', () => {
      frontSlab()
      useAppStore.getState().setGridSplit(null)
      stroke((s) => s.paintCell(0, -2))
      useAppStore.getState().setGridSplit(['x', 'y', 'z'])
      useAppStore.getState().setActiveVoxelKind('ramp')
      stroke((s) => {
        s.paintCell(0, -1, 0, 0)
        s.paintCell(0, -1, 0, 0)
      })
      expect(sub0()!.children[6]!.chamfer!.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 2 })
    })

    it('painting part of a whole chamfer voxel cuts the bevel to a plain block', () => {
      useAppStore.getState().setGridSplit(null)
      useAppStore.getState().setActiveVoxelKind('convex')
      stroke((s) => s.paintCell(0, -1))
      useAppStore.getState().setGridSplit(['z'])
      useAppStore.getState().setActiveVoxelKind('cube')
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      stroke((s) => s.paintCell(0, -1))
      const m = useAppStore.getState().model
      expect(m.chamfer.has(encodeKey(0, 0, 0))).toBe(false)
      expect(sub0()).toEqual({ split: ['z'], children: [{ slot: SLOT_B }, { slot: SLOT_M }] })
    })

    it('a bevel lands as a plain block where the voxel is cut finer than the grid cell', () => {
      useAppStore.getState().setGridSplit(['x', 'y'])
      useAppStore.getState().setActivePaletteSlot(SLOT_M)
      stroke((s) => s.paintCell(0, -1, 0, 0)) // one x-low quarter
      useAppStore.getState().setGridSplit(['x'])
      useAppStore.getState().setActiveVoxelKind('convex')
      useAppStore.getState().setActivePaletteSlot(SLOT_B)
      // x-low is cut along y (one quarter), so an x-high bevel can't be a single child: plain block.
      stroke((s) => s.paintCell(0, -1, 1, 0))
      expect(sub0()!.children.some((c) => c?.chamfer)).toBe(false)
    })
  })
})
