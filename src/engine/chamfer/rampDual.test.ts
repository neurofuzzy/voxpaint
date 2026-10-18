import { describe, expect, it } from 'vitest'
import type { Axis, ChamferCell, Orientation, Rotation } from '@/engine/grid/types'
import { boxFaceOf } from '@/engine/texture/types'
import { findDualRampRotation, findWedgeRampDual } from './rampDual'

const BASES: Array<{ axis: Axis; orientation: Orientation }> = [
  { axis: 'x', orientation: 1 },
  { axis: 'x', orientation: -1 },
  { axis: 'y', orientation: 1 },
  { axis: 'y', orientation: -1 },
  { axis: 'z', orientation: 1 },
  { axis: 'z', orientation: -1 },
]

const ROTATIONS: Rotation[] = [0, 1, 2, 3]

function rampCell(axis: Axis, orientation: Orientation, rotation: Rotation): ChamferCell {
  return { planeAxis: axis, planeOrientation: orientation, resolvedTo: { shapeKind: 'ramp', rotation } }
}

describe('findDualRampRotation', () => {
  it('is idempotent: searching the cell\'s own basis returns its own rotation', () => {
    for (const { axis, orientation } of BASES) {
      for (const rotation of ROTATIONS) {
        expect(findDualRampRotation(rampCell(axis, orientation, rotation), axis, orientation)).toBe(rotation)
      }
    }
  })

  it('matches exactly one rotation per target basis (ramp solids are distinct per rotation)', () => {
    // Count matches directly: same-basis search must yield exactly the source rotation.
    for (const { axis, orientation } of BASES) {
      for (const rotation of ROTATIONS) {
        const found = findDualRampRotation(rampCell(axis, orientation, rotation), axis, orientation)
        expect(found).toBe(rotation)
      }
    }
  })

  it('reproduces hand-derived duals: (x,+1,rot0) lives on (z,-1) as rot0', () => {
    // x/+1/rot0: U=(0,0,-1), V=(0,-1,0), W=(1,0,0), constraint x<=-z-side… i.e. solid x<=z,
    // extruded along Y. z/-1/rot0: U=(1,0,0), V=(0,-1,0), W=(0,0,-1), same x<=z solid.
    expect(findDualRampRotation(rampCell('x', 1, 0), 'z', -1)).toBe(0)
  })

  it('reproduces hand-derived duals: (y,+1,rot0) lives on (x,+1) as rot3', () => {
    // y/+1/rot0: solid x+y<=0 extruded along Z. x/+1/rot3 maps (u,v)->(v,-u), turning the
    // w+u<=0 profile into o·W<=o·V (x<=-y, same solid) with extrusion spun onto world Z.
    expect(findDualRampRotation(rampCell('y', 1, 0), 'x', 1)).toBe(3)
  })

  it('every ramp has a dual on a different basis with a different texture face', () => {
    for (const { axis, orientation } of BASES) {
      for (const rotation of ROTATIONS) {
        const cell = rampCell(axis, orientation, rotation)
        const sourceFace = boxFaceOf(axis, orientation)
        const duals = BASES.filter(
          (b) => boxFaceOf(b.axis, b.orientation) !== sourceFace,
        )
          .map((b) => ({ ...b, rotation: findDualRampRotation(cell, b.axis, b.orientation) }))
          .filter((d) => d.rotation !== null)
        expect(duals.length, `${axis},${orientation} rot${rotation} has no dual basis`).toBeGreaterThan(0)
      }
    }
  })

  it('returns null for non-ramp shapes and unresolved cells', () => {
    const convex: ChamferCell = { planeAxis: 'y', planeOrientation: 1, resolvedTo: { shapeKind: 'convex', rotation: 0 } }
    expect(findDualRampRotation(convex, 'x', 1)).toBeNull()
    const unresolved: ChamferCell = { planeAxis: 'y', planeOrientation: 1, resolvedTo: null }
    expect(findDualRampRotation(unresolved, 'x', 1)).toBeNull()
  })
})

function wedgeCell(axis: Axis, orientation: Orientation, rotation: Rotation): ChamferCell {
  return { planeAxis: axis, planeOrientation: orientation, resolvedTo: { shapeKind: 'wedge', rotation } }
}

describe('findWedgeRampDual', () => {
  it('every wedge has a congruent ramp on a different basis with a different texture face', () => {
    for (const { axis, orientation } of BASES) {
      for (const rotation of ROTATIONS) {
        const cell = wedgeCell(axis, orientation, rotation)
        const sourceFace = boxFaceOf(axis, orientation)
        const duals = BASES.filter((b) => boxFaceOf(b.axis, b.orientation) !== sourceFace)
          .map((b) => ({ ...b, rotation: findWedgeRampDual(cell, b.axis, b.orientation) }))
          .filter((d) => d.rotation !== null)
        expect(duals.length, `wedge ${axis},${orientation} rot${rotation} has no ramp dual`).toBeGreaterThan(0)
      }
    }
  })

  it('a wedge already on the target basis yields null (face already correct, no same-basis congruence)', () => {
    for (const { axis, orientation } of BASES) {
      for (const rotation of ROTATIONS) {
        expect(
          findWedgeRampDual(wedgeCell(axis, orientation, rotation), axis, orientation),
          `wedge ${axis},${orientation} rot${rotation} unexpectedly matches a same-basis ramp`,
        ).toBeNull()
      }
    }
  })

  it('church front cells: (z,+1) wedges are congruent to (y,+1) ramps', () => {
    expect(findWedgeRampDual(wedgeCell('z', 1, 3), 'y', 1)).toBe(2)
    expect(findWedgeRampDual(wedgeCell('z', 1, 0), 'y', 1)).toBe(0)
  })

  it('returns null for non-wedge shapes and unresolved cells', () => {
    const convex: ChamferCell = { planeAxis: 'y', planeOrientation: 1, resolvedTo: { shapeKind: 'convex', rotation: 0 } }
    expect(findWedgeRampDual(convex, 'x', 1)).toBeNull()
    const ramp = rampCell('y', 1, 0)
    expect(findWedgeRampDual(ramp, 'x', 1)).toBeNull()
    const unresolved: ChamferCell = { planeAxis: 'y', planeOrientation: 1, resolvedTo: null }
    expect(findWedgeRampDual(unresolved, 'x', 1)).toBeNull()
  })
})
