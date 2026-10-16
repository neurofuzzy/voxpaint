import { describe, expect, it } from 'vitest'
import type { Axis, ChamferCell, ChamferShapeKind, Orientation, Rotation } from '@/engine/grid/types'
import { mirrorClassification, rotateClassification90 } from '@/engine/tools/transform'
import { mirrorChamferCell, rotateChamferCell } from './chamferTransform'

const AXES: Axis[] = ['x', 'y', 'z']
const ORIENTATIONS: Orientation[] = [1, -1]
const ROTATIONS: Rotation[] = [0, 1, 2, 3]
const SHAPES: ChamferShapeKind[] = ['ramp', 'convex', 'concave', 'wedge', 'thin', 'half']

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
})
