import { describe, expect, it } from 'vitest'
import type { SplitAxis } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import { gridBox, worldBitsFromQuad } from '@/engine/grid/cellBox'
import { boxDisplayFootprint, logicalQuadrant, quadrantFromFractions } from './quadrant'

/** The 2D pipeline end to end: display quadrant → logical → world bits → grid box → display footprint. */
function hoverFootprint(p: ConstructionPlane, split: SplitAxis[], dqu: number, dqv: number) {
  const [qu, qv] = logicalQuadrant(p, [dqu, dqv])
  return boxDisplayFootprint(p, gridBox(p, split, worldBitsFromQuad(p, qu, qv)))
}

const plane = (axis: 'x' | 'y' | 'z', orientation: 1 | -1): ConstructionPlane => ({ axis, orientation, offset: 0, half: null })

describe('quadrantFromFractions', () => {
  it('returns null without a continuous position (synthetic events)', () => {
    expect(quadrantFromFractions(plane('z', 1), undefined, undefined)).toBeNull()
    expect(quadrantFromFractions(plane('z', 1), 0.7, undefined)).toBeNull()
    expect(quadrantFromFractions(plane('z', 1), undefined, 0.2)).toBeNull()
  })

  it('splits at the half mark (0.5 belongs to quadrant 1)', () => {
    const p = plane('z', 1)
    const lo = quadrantFromFractions(p, 0.49, 0.49)!
    const hi = quadrantFromFractions(p, 0.5, 0.5)!
    // Exact quadrant values depend on the plane's display mirrors (covered below); the
    // load-bearing fact is that the two sides of 0.5 are valid quadrants that disagree.
    expect(lo[0] === 0 || lo[0] === 1).toBe(true)
    expect(lo[1] === 0 || lo[1] === 1).toBe(true)
    expect(hi).not.toEqual(lo)
  })

  it('covers all four quadrants exactly once on every plane and orientation', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const orientation of [1, -1] as const) {
        const p = plane(axis, orientation)
        const seen = new Set<string>()
        for (const [fu, fv] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
          const q = quadrantFromFractions(p, fu, fv)
          expect(q, `${axis}${orientation} (${fu},${fv})`).not.toBeNull()
          seen.add(`${q![0]},${q![1]}`)
        }
        // A bijection on quadrants: mirroring may permute them, never collapse them.
        expect(seen.size, `${axis}${orientation}`).toBe(4)
      }
    }
  })

  it('ignores the integer part (only the fraction selects the quadrant)', () => {
    const p = plane('x', -1)
    expect(quadrantFromFractions(p, 3.25, -2.75)).toEqual(quadrantFromFractions(p, 0.25, 0.25))
  })
})

describe('grid-box display footprint', () => {
  it('covers the hovered display quadrant on every plane, orientation, and split', () => {
    // The 2D hover fill must agree with what a tap paints: the footprint it returns (in
    // display space, where the canvas draws it) always contains the hovered display
    // quadrant's center. The logical footprint alone fails this on mirrored planes
    // (XZ with Y up highlighted the opposite V half while painting stayed correct).
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const orientation of [1, -1] as const) {
        const p = plane(axis, orientation)
        for (const split of [['x'], ['y'], ['z'], ['x', 'y'], ['x', 'z'], ['y', 'z'], ['x', 'y', 'z']] as SplitAxis[][]) {
          for (const dqu of [0, 1]) {
            for (const dqv of [0, 1]) {
              const tag = `${axis}${orientation} [${split}] (${dqu},${dqv})`
              const [u0, v0, u1, v1] = hoverFootprint(p, split, dqu, dqv)
              expect(dqu * 0.5 + 0.25, `${tag} u`).toBeGreaterThanOrEqual(u0)
              expect(dqu * 0.5 + 0.25, `${tag} u`).toBeLessThan(u1)
              expect(dqv * 0.5 + 0.25, `${tag} v`).toBeGreaterThanOrEqual(v0)
              expect(dqv * 0.5 + 0.25, `${tag} v`).toBeLessThan(v1)
              expect(u1, `${tag} w`).toBeGreaterThan(u0)
              expect(v1, `${tag} h`).toBeGreaterThan(v0)
            }
          }
        }
      }
    }
  })

  it('matches the mini-cell the hovered quadrant paints (XZ, Y-up 4-split)', () => {
    // The reported case: bottom-left hover painted bottom-left while top-left lit up.
    // A 4-split's footprint must be exactly the hovered display quarter, on both Y facings.
    for (const orientation of [1, -1] as const) {
      const p = plane('y', orientation)
      for (const dqu of [0, 1]) {
        for (const dqv of [0, 1]) {
          expect(
            hoverFootprint(p, ['x', 'z'], dqu, dqv),
            `y${orientation} (${dqu},${dqv})`,
          ).toEqual([dqu * 0.5, dqv * 0.5, dqu * 0.5 + 0.5, dqv * 0.5 + 0.5])
        }
      }
    }
  })
})
