import { describe, expect, it } from 'vitest'
import type { Axis, ChamferCell, ChamferShapeKind, Orientation, Rotation } from '@/engine/grid/types'
import { mirrorClassification, rotateClassification90 } from '@/engine/tools/transform'
import { mirrorChamferCell, rotateChamferCell, spinSlabAboutLocalY } from './chamferTransform'

const AXES: Axis[] = ['x', 'y', 'z']
const ORIENTATIONS: Orientation[] = [1, -1]
const ROTATIONS: Rotation[] = [0, 1, 2, 3]
const SHAPES: ChamferShapeKind[] = ['ramp', 'convex', 'concave', 'wedge', 'thin', 'half', 'post', 'quarter', 'flat', 'flatwedge']

function cell(axis: Axis, orientation: Orientation, shape: ChamferShapeKind, rotation: Rotation): ChamferCell {
  return { planeAxis: axis, planeOrientation: orientation, resolvedTo: { shapeKind: shape, rotation } }
}

describe('chamferTransform round-trips', () => {
  it('cw then ccw (and back) is the identity for every shape on every basis', () => {
    for (const shape of SHAPES) {
      for (const axis of AXES) {
        for (const o of ORIENTATIONS) {
          for (const r of ROTATIONS) {
            const c = cell(axis, o, shape, r)
            for (const planeAxis of AXES) {
              expect(rotateChamferCell(rotateChamferCell(c, planeAxis, 'cw'), planeAxis, 'ccw')).toEqual(c)
              expect(rotateChamferCell(rotateChamferCell(c, planeAxis, 'ccw'), planeAxis, 'cw')).toEqual(c)
            }
          }
        }
      }
    }
  })

  it('double mirrors and four quarter-turns are the identity', () => {
    for (const shape of SHAPES) {
      for (const axis of AXES) {
        for (const o of ORIENTATIONS) {
          for (const r of ROTATIONS) {
            const c = cell(axis, o, shape, r)
            for (const planeAxis of AXES) {
              expect(mirrorChamferCell(mirrorChamferCell(c, planeAxis, true, false), planeAxis, true, false)).toEqual(c)
              expect(mirrorChamferCell(mirrorChamferCell(c, planeAxis, false, true), planeAxis, false, true)).toEqual(c)
              let spun = c
              for (let i = 0; i < 4; i++) spun = rotateChamferCell(spun, planeAxis, 'cw')
              expect(spun).toEqual(c)
            }
          }
        }
      }
    }
  })
})

describe('chamferTransform same-axis parity', () => {
  it('matches the legacy in-frame renumbering when the bevel is authored on the rotation plane', () => {
    for (const shape of SHAPES) {
      for (const axis of AXES) {
        for (const o of ORIENTATIONS) {
          for (const r of ROTATIONS) {
            const c = cell(axis, o, shape, r)
            const legacy = c.resolvedTo!
            expect(rotateChamferCell(c, axis, 'cw')).toEqual({
              planeAxis: axis,
              planeOrientation: o,
              resolvedTo: rotateClassification90(legacy, 'cw'),
            })
            expect(rotateChamferCell(c, axis, 'ccw')).toEqual({
              planeAxis: axis,
              planeOrientation: o,
              resolvedTo: rotateClassification90(legacy, 'ccw'),
            })
            expect(mirrorChamferCell(c, axis, true, false)).toEqual({
              planeAxis: axis,
              planeOrientation: o,
              resolvedTo: mirrorClassification(legacy, true, false),
            })
            expect(mirrorChamferCell(c, axis, false, true)).toEqual({
              planeAxis: axis,
              planeOrientation: o,
              resolvedTo: mirrorClassification(legacy, false, true),
            })
          }
        }
      }
    }
  })
})

describe('chamferTransform cross-axis mapping', () => {
  it('re-bases an x-authored ramp onto the turned authoring face when spun about z', () => {
    // Hand-derived from the prefab corner sets: ramp-0 on (x,1) occupies the x=-0.5 slab plus
    // the z=+0.5 edge on +x; turning cw about z sends (x,y,z) -> (y,-x,z), leaving corners
    // {(+,+,−),(−,+,−),(−,+,+),(+,+,+),(−,−,+),(+,−,+)}. The tracked authoring face (+x -> −y)
    // is (y,−1), where that corner set is exactly ramp-1 (verified element by element).
    expect(rotateChamferCell(cell('x', 1, 'ramp', 0), 'z', 'cw')).toEqual({
      planeAxis: 'y',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'ramp', rotation: 1 },
    })
  })

  it('moves (but never shapes) unresolved cells by their authoring normal', () => {
    const unresolved: ChamferCell = { planeAxis: 'x', planeOrientation: 1, resolvedTo: null }
    // +x turns to -y under the same cw-about-z motion.
    expect(rotateChamferCell(unresolved, 'z', 'cw')).toEqual({
      planeAxis: 'y',
      planeOrientation: -1,
      resolvedTo: null,
    })
  })

  it('swings thin slabs onto the turned normal without ever rotating them', () => {
    expect(mirrorChamferCell(cell('x', 1, 'thin', 0), 'z', true, false)).toEqual({
      planeAxis: 'x',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'thin', rotation: 0 },
    })
  })

  it('swings half slabs onto the turned normal exactly like thin slabs', () => {
    // The flush slab is fully determined by its outward normal, so the tracked basis carries it
    // exactly — same ride-along as thin, verified here for a cross-axis turn.
    expect(mirrorChamferCell(cell('x', 1, 'half', 0), 'z', true, false)).toEqual({
      planeAxis: 'x',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'half', rotation: 0 },
    })
    expect(rotateChamferCell(cell('x', 1, 'half', 0), 'z', 'cw')).toEqual({
      planeAxis: 'y',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'half', rotation: 0 },
    })
  })

  it('swings posts onto the turned normal exactly like thin slabs', () => {
    // The centered column is fully determined by its long axis, so the tracked basis carries
    // it exactly — same ride-along as the slabs, never a shape change.
    expect(mirrorChamferCell(cell('x', 1, 'post', 0), 'z', true, false)).toEqual({
      planeAxis: 'x',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'post', rotation: 0 },
    })
    expect(rotateChamferCell(cell('x', 1, 'post', 0), 'z', 'cw')).toEqual({
      planeAxis: 'y',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'post', rotation: 0 },
    })
  })

  it('re-bases quarter columns by exact corner-solid match (same-plane turn steps the corner)', () => {
    // Same-axis turns renumber through the legacy corner tables, like the other corner shapes.
    expect(rotateChamferCell(cell('z', 1, 'quarter', 0), 'z', 'cw')).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'quarter', rotation: 1 },
    })
    expect(mirrorChamferCell(cell('z', 1, 'quarter', 0), 'z', true, false)).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'quarter', rotation: 3 },
    })
  })

  it('swings flats onto the turned normal exactly like thin slabs', () => {
    // The centre quad is fully determined by its facing normal, so the tracked basis carries
    // it exactly — same ride-along as the slabs, never a shape change.
    expect(mirrorChamferCell(cell('x', 1, 'flat', 0), 'z', true, false)).toEqual({
      planeAxis: 'x',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'flat', rotation: 0 },
    })
    expect(rotateChamferCell(cell('x', 1, 'flat', 0), 'z', 'cw')).toEqual({
      planeAxis: 'y',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'flat', rotation: 0 },
    })
  })

  it('re-bases flat wedges by exact diagonal-solid match (same-plane turn steps the opening)', () => {
    // Same-axis turns renumber through the legacy corner tables, like the wedge.
    expect(rotateChamferCell(cell('z', 1, 'flatwedge', 0), 'z', 'cw')).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flatwedge', rotation: 1 },
    })
    expect(mirrorChamferCell(cell('z', 1, 'flatwedge', 0), 'z', true, false)).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flatwedge', rotation: 3 },
    })
    expect(mirrorChamferCell(cell('z', 1, 'flatwedge', 0), 'z', false, true)).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flatwedge', rotation: 1 },
    })
  })
})

describe('spinSlabAboutLocalY (slab click-to-rotate)', () => {
  it('swings a z-faced half slab through −z → +x → +z → −x, one 90° step per click', () => {
    // Hand-derived: z-plane v is (0,−1,0); +90° about it sends the normal N → V × N.
    // (0,0,−1) → (1,0,0) → (0,0,1) → (−1,0,0) → (0,0,−1).
    const bases: [Axis, Orientation][] = [
      ['z', -1],
      ['x', 1],
      ['z', 1],
      ['x', -1],
    ]
    let c = cell('z', -1, 'half', 0)
    for (const [axis, orientation] of bases.slice(1).concat([bases[0]])) {
      c = spinSlabAboutLocalY(c)
      expect(c.planeAxis).toBe(axis)
      expect(c.planeOrientation).toBe(orientation)
      expect(c.resolvedTo).toEqual({ shapeKind: 'half', rotation: 0 })
    }
  })

  it('four spins return every x/z-faced thin/half/post/flat slab to its start', () => {
    // x/z bases share the world −y local v axis, so the facing cycles in place through four
    // distinct facings (two world axes, both signs) and back.
    for (const shape of ['thin', 'half', 'post', 'flat'] as const) {
      for (const axis of ['x', 'z'] as const) {
        for (const o of ORIENTATIONS) {
          let c = cell(axis, o, shape, 0)
          const seen = new Set<string>()
          for (let i = 0; i < 4; i++) {
            c = spinSlabAboutLocalY(c)
            // Every step moves the facing (never a no-op) while keeping shape and rotation.
            expect(c.resolvedTo).toEqual({ shapeKind: shape, rotation: 0 })
            seen.add(`${c.planeAxis},${c.planeOrientation}`)
          }
          expect(c).toEqual(cell(axis, o, shape, 0))
          expect(seen.size).toBe(4)
        }
      }
    }
  })

  it('a y-faced slab tips onto the x/z cycle on first spin, then cycles there', () => {
    // The y basis's local v is a world z axis, so the first spin leaves the y axis for x —
    // after that the facing stays in the x/z 4-cycle (the paint-time V is not stored on the
    // cell, so the original y facing is not recoverable by spinning — repaint it instead).
    for (const shape of ['thin', 'half', 'post', 'flat'] as const) {
      for (const o of ORIENTATIONS) {
        const first = spinSlabAboutLocalY(cell('y', o, shape, 0))
        expect(first.planeAxis).toBe('x')
        expect(first.resolvedTo).toEqual({ shapeKind: shape, rotation: 0 })
        let c = first
        for (let i = 0; i < 4; i++) c = spinSlabAboutLocalY(c)
        expect(c).toEqual(first)
      }
    }
  })

  it('leaves non-slab cells untouched', () => {
    const wedge = cell('z', 1, 'wedge', 2)
    expect(spinSlabAboutLocalY(wedge)).toBe(wedge)
    const ramp = cell('x', -1, 'ramp', 1)
    expect(spinSlabAboutLocalY(ramp)).toBe(ramp)
    const quarter = cell('z', 1, 'quarter', 2)
    expect(spinSlabAboutLocalY(quarter)).toBe(quarter)
    const flatwedge = cell('z', 1, 'flatwedge', 2)
    expect(spinSlabAboutLocalY(flatwedge)).toBe(flatwedge)
    const unresolved: ChamferCell = { planeAxis: 'y', planeOrientation: 1, resolvedTo: null }
    expect(spinSlabAboutLocalY(unresolved)).toBe(unresolved)
  })
})
