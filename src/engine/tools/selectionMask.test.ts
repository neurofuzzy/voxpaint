import { describe, expect, it } from 'vitest'
import type { SelectionRegion } from '@/store/types'
import { rotateRegion90 } from './selectionMask'
import { rotateClip90 } from '@/engine/texture/texelOps'

/** An L-shaped 3x2 mask — asymmetric under both rotation and mirroring, so a wrong index mapping
 * can't accidentally round-trip. */
function lRegion(): SelectionRegion {
  return { originU: 4, originV: 7, width: 3, height: 2, mask: new Uint8Array([1, 1, 1, 1, 0, 0]) }
}

describe('rotateRegion90', () => {
  it('swaps extents and keeps the origin corner', () => {
    const out = rotateRegion90(lRegion(), 'ccw')
    expect([out.width, out.height]).toEqual([2, 3])
    expect([out.originU, out.originV]).toEqual([4, 7])
  })

  it('preserves the number of selected cells in both directions', () => {
    for (const dir of ['cw', 'ccw'] as const) {
      const out = rotateRegion90(lRegion(), dir)
      expect(out.mask.reduce((n, m) => n + m, 0)).toBe(4)
    }
  })

  it('rotates counter-clockwise as the exact inverse of clockwise', () => {
    const source = lRegion()
    const roundTrip = rotateRegion90(rotateRegion90(source, 'cw'), 'ccw')
    expect([roundTrip.width, roundTrip.height]).toEqual([source.width, source.height])
    expect([...roundTrip.mask]).toEqual([...source.mask])
  })

  it('sends the top-left cell to the bottom-left going counter-clockwise', () => {
    // Single cell at (du=0, dv=0) of a 3x2 box -> CCW puts it at the bottom-left of the 2x3 result.
    const one: SelectionRegion = { originU: 0, originV: 0, width: 3, height: 2, mask: new Uint8Array([1, 0, 0, 0, 0, 0]) }
    const out = rotateRegion90(one, 'ccw')
    expect([...out.mask]).toEqual([0, 0, 0, 0, 1, 0]) // row 2 (last), column 0
  })

  it('defaults to clockwise', () => {
    expect([...rotateRegion90(lRegion()).mask]).toEqual([...rotateRegion90(lRegion(), 'cw').mask])
  })
})

describe('rotateClip90 (texel clips share rotateRegion90\'s index mapping)', () => {
  it('agrees cell-for-cell with rotateRegion90 in both directions', () => {
    for (const dir of ['cw', 'ccw'] as const) {
      const region = lRegion()
      const clip = rotateClip90({ width: 3, height: 2, cells: Uint8Array.from(region.mask) }, dir)
      const rotated = rotateRegion90(region, dir)
      expect([clip.width, clip.height]).toEqual([rotated.width, rotated.height])
      expect([...clip.cells]).toEqual([...rotated.mask])
    }
  })
})
