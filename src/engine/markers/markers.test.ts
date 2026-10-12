import { describe, expect, it } from 'vitest'
import { MARKER_COLORS } from './types'
import { createMarker, markerColorHex, markerDirectionWord, markerInBounds, markerNodeName, markerWorldCenter } from './markers'

describe('markers', () => {
  it('creates markers with the given color and draw-time basis', () => {
    expect(createMarker([0, 0, 0], 2, 'x', -1)).toEqual({
      id: expect.any(String),
      color: 2,
      position: [0, 0, 0],
      planeAxis: 'x',
      planeOrientation: -1,
    })
  })

  it('resolves color hex with fallback', () => {
    expect(markerColorHex(1)).toBe(MARKER_COLORS[1])
    expect(markerColorHex(99)).toBe(MARKER_COLORS[0])
  })

  it('names compass directions per basis', () => {
    expect(markerDirectionWord('x', 1)).toBe('east')
    expect(markerDirectionWord('x', -1)).toBe('west')
    expect(markerDirectionWord('y', 1)).toBe('up')
    expect(markerDirectionWord('y', -1)).toBe('down')
    expect(markerDirectionWord('z', 1)).toBe('south')
    expect(markerDirectionWord('z', -1)).toBe('north')
  })

  it('computes world center with Y scale', () => {
    expect(markerWorldCenter([0, 0, 0])).toEqual([0.5, 0.5, 0.5])
    expect(markerWorldCenter([0, 0, 0], 2)).toEqual([0.5, 1, 0.5])
    expect(markerWorldCenter([0, 1, 0], 0.5)).toEqual([0.5, 0.75, 0.5])
  })

  it('checks working bounds', () => {
    expect(markerInBounds({ id: 'a', color: 0, position: [0, 0, 0], planeAxis: 'y', planeOrientation: 1 }, 16)).toBe(true)
    expect(markerInBounds({ id: 'a', color: 0, position: [8, 0, 0], planeAxis: 'y', planeOrientation: 1 }, 16)).toBe(false)
  })

  it('names nodes by color hex and facing, and dedupes', () => {
    const taken = new Set<string>()
    const a = { id: 'aaaaaaaa-bbbb', color: 1, position: [0, 0, 0] as [number, number, number], planeAxis: 'x' as const, planeOrientation: -1 as const }
    const b = { id: 'aaaaaaaa-cccc', color: 1, position: [1, 0, 0] as [number, number, number], planeAxis: 'x' as const, planeOrientation: -1 as const }
    const na = markerNodeName(a, taken)
    const nb = markerNodeName(b, taken)
    expect(na).not.toBe(nb)
    expect(na).toBe(`marker_${MARKER_COLORS[1].replace('#', '')}_west_aaaaaaaa`)
  })
})
