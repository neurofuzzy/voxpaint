import { describe, expect, it } from 'vitest'
import { MARKER_COLORS } from './types'
import { createMarker, markerColorHex, markerInBounds, markerNodeName, markerWorldCenter } from './markers'

describe('markers', () => {
  it('creates markers with the given color', () => {
    expect(createMarker([0, 0, 0], 2).color).toBe(2)
  })

  it('resolves color hex with fallback', () => {
    expect(markerColorHex(1)).toBe(MARKER_COLORS[1])
    expect(markerColorHex(99)).toBe(MARKER_COLORS[0])
  })

  it('computes world center with Y scale', () => {
    expect(markerWorldCenter([0, 0, 0])).toEqual([0.5, 0.5, 0.5])
    expect(markerWorldCenter([0, 0, 0], 2)).toEqual([0.5, 1, 0.5])
    expect(markerWorldCenter([0, 1, 0], 0.5)).toEqual([0.5, 0.75, 0.5])
  })

  it('checks working bounds', () => {
    expect(markerInBounds({ id: 'a', color: 0, position: [0, 0, 0] }, 16)).toBe(true)
    expect(markerInBounds({ id: 'a', color: 0, position: [8, 0, 0] }, 16)).toBe(false)
  })

  it('names nodes by color hex and dedupes', () => {
    const taken = new Set<string>()
    const a = { id: 'aaaaaaaa-bbbb', color: 1, position: [0, 0, 0] as [number, number, number] }
    const b = { id: 'aaaaaaaa-cccc', color: 1, position: [1, 0, 0] as [number, number, number] }
    const na = markerNodeName(a, taken)
    const nb = markerNodeName(b, taken)
    expect(na).not.toBe(nb)
    expect(na).toBe(`marker_${MARKER_COLORS[1].replace('#', '')}_aaaaaaaa`)
  })
})
