import { describe, expect, it } from 'vitest'
import type { Axis, ChamferClassification, Orientation, Rotation } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import type { ClipboardData } from '@/store/types'
import { transformClipboardToPlane } from './clipboard'
import { mirrorClassification, mirrorClipboard, rotateClipboard90 } from './transform'

const plane = (axis: Axis, orientation: Orientation): ConstructionPlane => ({ axis, orientation, offset: 0 })

const ALL_PLANES: ConstructionPlane[] = (['x', 'y', 'z'] as const).flatMap((axis) =>
  ([1, -1] as const).map((orientation) => plane(axis, orientation)),
)

function clip(from: ConstructionPlane, cells: ClipboardData['cells'], width = 3, height = 2): ClipboardData {
  return { width, height, originU: 0, originV: 0, copyPlaneAxis: from.axis, copyPlaneOrientation: from.orientation, cells }
}

const ramp = (rotation: Rotation): ChamferClassification => ({ shapeKind: 'ramp', rotation })
const convex = (rotation: Rotation): ChamferClassification => ({ shapeKind: 'convex', rotation })

describe('mirrorClassification', () => {
  it('is an involution for every kind and rotation', () => {
    const kinds = ['ramp', 'convex', 'concave', 'wedge', 'thin'] as const
    for (const shapeKind of kinds) {
      for (const rotation of [0, 1, 2, 3] as const) {
        for (const [mu, mv] of [
          [true, false],
          [false, true],
          [true, true],
        ] as const) {
          const c = { shapeKind, rotation }
          expect(mirrorClassification(mirrorClassification(c, mu, mv), mu, mv)).toEqual(c)
        }
      }
    }
  })

  it('leaves the rotationally symmetric thin slab alone', () => {
    expect(mirrorClassification({ shapeKind: 'thin', rotation: 0 }, true, true)).toEqual({ shapeKind: 'thin', rotation: 0 })
  })

  it('mirrors a ramp in u by swapping its open side E<->W', () => {
    // rotation = (openSide + 3) % 4, sides N=0,E=1,S=2,W=3 -> E-open is rotation 0, W-open is 2.
    expect(mirrorClassification(ramp(0), true, false)).toEqual(ramp(2))
    expect(mirrorClassification(ramp(2), true, false)).toEqual(ramp(0))
    // N-open (rotation 3) and S-open (rotation 1) are untouched by a u mirror.
    expect(mirrorClassification(ramp(3), true, false)).toEqual(ramp(3))
    expect(mirrorClassification(ramp(1), true, false)).toEqual(ramp(1))
  })

  it('mirrors a ramp in v by swapping its open side N<->S', () => {
    expect(mirrorClassification(ramp(3), false, true)).toEqual(ramp(1))
    expect(mirrorClassification(ramp(0), false, true)).toEqual(ramp(0))
  })

  it('mirrors a corner-numbered shape across the corner ordering NE=0,SE=1,SW=2,NW=3', () => {
    expect(mirrorClassification(convex(0), true, false)).toEqual(convex(3)) // NE -> NW
    expect(mirrorClassification(convex(0), false, true)).toEqual(convex(1)) // NE -> SE
    expect(mirrorClassification(convex(0), true, true)).toEqual(convex(2)) // NE -> SW
  })
})

describe('rotateClipboard90 / mirrorClipboard', () => {
  const source = clip(plane('z', 1), [{ du: 0, dv: 0, chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: ramp(0) } }])

  it('carries the source plane through so a later paste can still rebase', () => {
    expect(rotateClipboard90(source).copyPlaneAxis).toBe('z')
    expect(mirrorClipboard(source, 'horizontal').copyPlaneOrientation).toBe(1)
  })

  it('turns chamfer shapes with the cells rather than leaving them bevelling the old way', () => {
    expect(rotateClipboard90(source).cells[0].chamfer?.resolvedTo).toEqual(ramp(1))
    expect(mirrorClipboard(source, 'horizontal').cells[0].chamfer?.resolvedTo).toEqual(ramp(2))
  })

  it('does not mutate the source clipboard', () => {
    rotateClipboard90(source)
    mirrorClipboard(source, 'vertical')
    expect(source.cells[0].chamfer?.resolvedTo).toEqual(ramp(0))
  })
})

describe('transformClipboardToPlane', () => {
  it('returns content copied off the destination plane untouched', () => {
    const c = clip(plane('z', 1), [{ du: 1, dv: 0 }])
    expect(transformClipboardToPlane(c, plane('z', 1))).toBe(c)
  })

  it('returns float content with no recorded source plane untouched', () => {
    const c: ClipboardData = { width: 1, height: 1, cells: [{ du: 0, dv: 0 }] }
    expect(transformClipboardToPlane(c, plane('x', 1))).toBe(c)
  })

  it('rebases chamfers onto the destination plane (the +Z -> +X case)', () => {
    const c = clip(plane('z', 1), [{ du: 0, dv: 0, chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: ramp(0) } }])
    const out = transformClipboardToPlane(c, plane('x', 1))
    expect(out.cells[0].chamfer).toEqual({ planeAxis: 'x', planeOrientation: 1, resolvedTo: ramp(0) })
  })

  it('mirrors shapes when the two planes disagree about which way u is drawn', () => {
    // +Z draws logical u unmirrored, -Z mirrors it, so the same picture needs the ramp flipped.
    const c = clip(plane('z', 1), [{ du: 0, dv: 0, chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: ramp(0) } }])
    const out = transformClipboardToPlane(c, plane('z', -1))
    expect(out.cells[0].chamfer).toEqual({ planeAxis: 'z', planeOrientation: -1, resolvedTo: ramp(2) })
    expect(out.cells[0].du).toBe(c.width - 1)
  })

  it('leaves a chamfer baked on some other plane verbatim', () => {
    const foreign = { planeAxis: 'y' as Axis, planeOrientation: 1 as Orientation, resolvedTo: ramp(0) }
    const c = clip(plane('z', 1), [{ du: 0, dv: 0, chamfer: foreign }])
    expect(transformClipboardToPlane(c, plane('x', 1)).cells[0].chamfer).toEqual(foreign)
  })

  it('does not mutate the source clipboard', () => {
    const c = clip(plane('z', 1), [{ du: 0, dv: 0, chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: ramp(0) } }])
    transformClipboardToPlane(c, plane('y', 1))
    expect(c.cells[0]).toEqual({ du: 0, dv: 0, chamfer: { planeAxis: 'z', planeOrientation: 1, resolvedTo: ramp(0) } })
    expect(c.copyPlaneAxis).toBe('z')
  })

  it('preserves every cell\'s screen position across all 30 plane pairs', () => {
    // The invariant the whole transform exists for: a cell's screen coordinate after pasting at the
    // rebased origin equals its screen coordinate at the point it was copied.
    const cells = [
      { du: 0, dv: 0 },
      { du: 2, dv: 1 },
      { du: 1, dv: 0 },
    ]
    for (const from of ALL_PLANES) {
      for (const to of ALL_PLANES) {
        if (from.axis === to.axis && from.orientation === to.orientation) continue
        const c = clip(from, cells)
        const out = transformClipboardToPlane(c, to)

        for (const cell of cells) {
          const srcScreen = [toDisplayU(from, c.originU! + cell.du), toDisplayV(from, c.originV! + cell.dv)]
          const moved = out.cells.find((o) => o.du === (srcScreenMirrorsU(from, to) ? c.width - 1 - cell.du : cell.du) && o.dv === (srcScreenMirrorsV(from, to) ? c.height - 1 - cell.dv : cell.dv))!
          const dstScreen = [toDisplayU(to, out.originU! + moved.du), toDisplayV(to, out.originV! + moved.dv)]
          expect(dstScreen).toEqual(srcScreen)
        }
      }
    }
  })

  it('round-trips back to the original when transformed there and back', () => {
    for (const from of ALL_PLANES) {
      for (const to of ALL_PLANES) {
        const c = clip(from, [{ du: 0, dv: 0, chamfer: { planeAxis: from.axis, planeOrientation: from.orientation, resolvedTo: convex(1) } }])
        expect(transformClipboardToPlane(transformClipboardToPlane(c, to), from)).toEqual(c)
      }
    }
  })
})

function srcScreenMirrorsU(from: ConstructionPlane, to: ConstructionPlane): boolean {
  return toDisplayU(from, 0) !== toDisplayU(to, 0)
}

function srcScreenMirrorsV(from: ConstructionPlane, to: ConstructionPlane): boolean {
  return toDisplayV(from, 0) !== toDisplayV(to, 0)
}
