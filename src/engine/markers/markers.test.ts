import { describe, expect, it } from 'vitest'
import { createMarker, markerInBounds, markerNodeName, markerWorldCenter, sanitizeMarkerLabel } from './markers'

describe('markers', () => {
  it('creates sequential default labels', () => {
    expect(createMarker([0, 0, 0], 0).label).toBe('Marker 1')
    expect(createMarker([1, 2, 3], 2).label).toBe('Marker 3')
  })

  it('computes world center with Y scale', () => {
    expect(markerWorldCenter([0, 0, 0])).toEqual([0.5, 0.5, 0.5])
    expect(markerWorldCenter([0, 0, 0], 2)).toEqual([0.5, 1, 0.5])
    expect(markerWorldCenter([0, 1, 0], 0.5)).toEqual([0.5, 0.75, 0.5])
  })

  it('checks working bounds', () => {
    expect(markerInBounds({ id: 'a', label: 'x', position: [0, 0, 0] }, 16)).toBe(true)
    expect(markerInBounds({ id: 'a', label: 'x', position: [8, 0, 0] }, 16)).toBe(false)
  })

  it('sanitizes labels and dedupes node names', () => {
    expect(sanitizeMarkerLabel('tree oak 01!')).toBe('tree_oak_01')
    expect(sanitizeMarkerLabel('!!!')).toBe('marker')
    const taken = new Set<string>()
    const a = { id: 'aaaaaaaa-bbbb', label: 'Tree', position: [0, 0, 0] as [number, number, number] }
    const b = { id: 'aaaaaaaa-cccc', label: 'Tree', position: [1, 0, 0] as [number, number, number] }
    const na = markerNodeName(a, taken)
    const nb = markerNodeName(b, taken)
    expect(na).not.toBe(nb)
    expect(na.startsWith('marker_Tree_')).toBe(true)
  })
})
