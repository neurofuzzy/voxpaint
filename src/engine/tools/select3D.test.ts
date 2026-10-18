import { describe, expect, it } from 'vitest'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { marqueeSelection } from './select3D'

const Z_PLANE: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0 }

describe('marqueeSelection', () => {
  it('identical corners yield a 1x1 tap selection', () => {
    const from = gridCoordFromPixel(Z_PLANE, 4, 4)
    const region = marqueeSelection(Z_PLANE, from, from)
    expect(region).toEqual({ originU: 4, originV: 4, width: 1, height: 1, mask: new Uint8Array([1]) })
  })

  it('spans the dragged rect regardless of drag direction', () => {
    const a = gridCoordFromPixel(Z_PLANE, 2, 3)
    const b = gridCoordFromPixel(Z_PLANE, 5, 6)
    const forward = marqueeSelection(Z_PLANE, a, b)
    const backward = marqueeSelection(Z_PLANE, b, a)
    for (const region of [forward, backward]) {
      expect(region.originU).toBe(2)
      expect(region.originV).toBe(3)
      expect(region.width).toBe(4)
      expect(region.height).toBe(4)
      expect(region.mask).toEqual(new Uint8Array(16).fill(1))
    }
  })

  it('resolves in the given plane frame on other axes', () => {
    const plane: ConstructionPlane = { axis: 'x', orientation: -1, offset: 0 }
    const from: [number, number, number] = [0, 1, 2]
    const to: [number, number, number] = [0, 3, 5]
    const region = marqueeSelection(plane, from, to)
    // Cross-checked against the 2D canvas mapping, not hand-derived.
    const a = pixelFromGridCoord(plane, from)
    const b = pixelFromGridCoord(plane, to)
    expect(region.originU).toBe(Math.min(a.u, b.u))
    expect(region.originV).toBe(Math.min(a.v, b.v))
    expect(region.width).toBe(Math.abs(b.u - a.u) + 1)
    expect(region.height).toBe(Math.abs(b.v - a.v) + 1)
  })
})
