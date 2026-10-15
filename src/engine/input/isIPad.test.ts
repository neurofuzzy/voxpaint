import { afterEach, describe, expect, it, vi } from 'vitest'
import { isIPad } from './isIPad'

function stubNavigator(userAgent: string, platform: string, maxTouchPoints: number) {
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isIPad', () => {
  it('matches classic iPad user agents', () => {
    stubNavigator('Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15', 'iPad', 5)
    expect(isIPad()).toBe(true)
  })

  it('matches modern iPadOS pretending to be a Mac, via touch support', () => {
    stubNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      'MacIntel',
      5,
    )
    expect(isIPad()).toBe(true)
  })

  it('rejects a real Mac without touch support', () => {
    stubNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      'MacIntel',
      0,
    )
    expect(isIPad()).toBe(false)
  })

  it('rejects iPhone and Windows', () => {
    stubNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'iPhone', 5)
    expect(isIPad()).toBe(false)
    stubNavigator('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Win32', 10)
    expect(isIPad()).toBe(false)
  })
})
