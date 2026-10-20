import { describe, expect, it } from 'vitest'
import { bresenhamLine, dominantAxisLine, snapToOrtho } from './lineUtils'

describe('dominantAxisLine (3D shift-paint, Zanpo-style axis lock)', () => {
  it('runs along the farther axis at the anchor minor coordinate', () => {
    // u travels 3, v travels 1 → u line at v0, anchor-excluded, endpoint-included.
    expect(dominantAxisLine(0, 0, 3, 1)).toEqual([[1, 0], [2, 0], [3, 0]])
    // v travels farther → v line at u0, negative direction.
    expect(dominantAxisLine(2, 2, 1, -1)).toEqual([[2, 1], [2, 0], [2, -1]])
  })

  it('breaks ties toward u', () => {
    expect(dominantAxisLine(0, 0, 2, 2)).toEqual([[1, 0], [2, 0]])
    expect(dominantAxisLine(0, 0, -2, 2)).toEqual([[-1, 0], [-2, 0]])
  })

  it('yields just the cell for a same-cell anchor/target (re-tap)', () => {
    expect(dominantAxisLine(4, -3, 4, -3)).toEqual([[4, -3]])
  })

  it('is a prefix-compatible subset of the snapped bresenham diagonal', () => {
    // A pure-axis drag agrees with bresenham minus the anchor.
    const [, ...rest] = bresenhamLine(0, 0, 3, 0)
    expect(dominantAxisLine(0, 0, 3, 0)).toEqual(rest)
    // snapToOrtho snaps a near-axis drag onto the axis.
    expect(snapToOrtho(0, 0, 3, 1)).toEqual([3, 0])
  })
})
