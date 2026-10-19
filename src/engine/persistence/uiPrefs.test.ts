import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUiPrefs, savePlanePref, saveUiPrefs } from './uiPrefs'

/** UI prefs live in localStorage, which the node test env lacks — stub an in-memory one. */
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  })
  return store
}

describe('construction-plane prefs', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips the plane pose through save/load', () => {
    savePlanePref({ axis: 'x', orientation: -1, offset: 3 })
    expect(loadUiPrefs().plane).toEqual({ axis: 'x', orientation: -1, offset: 3 })
  })

  it('preserves unrelated prefs across plane saves', () => {
    saveUiPrefs({ dontShowSplash: true, layoutMode: '3d-only' })
    savePlanePref({ axis: 'y', orientation: 1, offset: -8 })
    const prefs = loadUiPrefs()
    expect(prefs.layoutMode).toBe('3d-only')
    expect(prefs.dontShowSplash).toBe(true)
    expect(prefs.plane).toEqual({ axis: 'y', orientation: 1, offset: -8 })
  })

  it('drops corrupt planes (bad axis, bad orientation, non-integer offset)', () => {
    const raw = (plane: unknown) =>
      localStorage.setItem('voxpaint:ui-prefs:v1', JSON.stringify({ dontShowSplash: false, plane }))
    raw({ axis: 'w', orientation: 1, offset: 0 })
    expect(loadUiPrefs().plane).toBeUndefined()
    raw({ axis: 'z', orientation: 0, offset: 0 })
    expect(loadUiPrefs().plane).toBeUndefined()
    raw({ axis: 'z', orientation: 1, offset: 1.5 })
    expect(loadUiPrefs().plane).toBeUndefined()
    raw('ground')
    expect(loadUiPrefs().plane).toBeUndefined()
  })

  it('reads unset as undefined (store default applies)', () => {
    expect(loadUiPrefs().plane).toBeUndefined()
  })
})
