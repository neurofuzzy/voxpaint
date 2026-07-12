import { describe, expect, it } from 'vitest'
import { overlayChannel } from './overlay'

describe('overlayChannel', () => {
  it('is neutral (no change) at blend 0.5', () => {
    for (const base of [0.1, 0.3, 0.7, 0.9]) {
      expect(overlayChannel(base, 0.5)).toBeCloseTo(base, 10)
    }
  })

  it('darkens below 0.5 and lightens above 0.5', () => {
    expect(overlayChannel(0.6, 0.2)).toBeLessThan(0.6)
    expect(overlayChannel(0.6, 0.8)).toBeGreaterThan(0.6)
  })

  it('clamps toward the extremes at blend 0 and 1', () => {
    expect(overlayChannel(0.6, 0)).toBeCloseTo(0.2, 10) // 2*0.6-1
    expect(overlayChannel(0.4, 1)).toBeCloseTo(0.8, 10) // 2*0.4
  })
})
