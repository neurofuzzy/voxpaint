import { describe, expect, it } from 'vitest'
import { effectiveExtent, viewOriginShift, withinWorkingBounds } from './GridStore'

describe('effectiveExtent (odd rounds up to an even working grid)', () => {
  it('leaves even sizes unchanged', () => {
    expect(effectiveExtent(8)).toBe(8)
    expect(effectiveExtent(16)).toBe(16)
    expect(effectiveExtent(24)).toBe(24)
    expect(effectiveExtent(10)).toBe(10)
  })
  it('rounds odd sizes up by one', () => {
    expect(effectiveExtent(9)).toBe(10)
    expect(effectiveExtent(3)).toBe(4)
    expect(effectiveExtent(31)).toBe(32)
  })
})

describe('viewOriginShift (view-only half-cell nudge)', () => {
  it('is 0 for even and 0.5 for odd', () => {
    expect(viewOriginShift(16)).toBe(0)
    expect(viewOriginShift(10)).toBe(0)
    expect(viewOriginShift(9)).toBe(0.5)
    expect(viewOriginShift(3)).toBe(0.5)
  })
})

describe('withinWorkingBounds', () => {
  it('is unchanged for even extents', () => {
    expect(withinWorkingBounds([-8, -8, -8], 16)).toBe(true)
    expect(withinWorkingBounds([7, 7, 7], 16)).toBe(true)
    expect(withinWorkingBounds([8, 0, 0], 16)).toBe(false)
    expect(withinWorkingBounds([-9, 0, 0], 16)).toBe(false)
  })
  it('uses the even effective grid for odd extents (9 → the 10-cell range -5..4)', () => {
    // Odd 9 works on the effective 10-grid, so the paintable range is -5..4 on every axis.
    expect(withinWorkingBounds([0, 0, 0], 9)).toBe(true)
    expect(withinWorkingBounds([-5, -5, -5], 9)).toBe(true) // low corner of the even grid
    expect(withinWorkingBounds([4, 4, 4], 9)).toBe(true) // high corner
    expect(withinWorkingBounds([5, 0, 0], 9)).toBe(false) // one past the top
    expect(withinWorkingBounds([-6, 0, 0], 9)).toBe(false)
  })
})
