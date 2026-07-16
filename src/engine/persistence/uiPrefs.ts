/**
 * App-level UI preferences, persisted outside the project autosave slot (they're about the app,
 * not the artwork). Same namespaced-key + try/catch pattern as `autosave.ts`, but intentionally
 * separate storage so clearing a project never wipes onboarding state.
 */

const UI_PREFS_KEY = 'voxpaint:ui-prefs:v1'

export type UiPrefs = {
  /** True once the user has ticked "Don't show again" on the splash screen. */
  dontShowSplash: boolean
}

const DEFAULT_UI_PREFS: UiPrefs = { dontShowSplash: false }

/** Reads persisted UI prefs, falling back to defaults on any missing/corrupt/unavailable storage. */
export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return { ...DEFAULT_UI_PREFS }
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return { ...DEFAULT_UI_PREFS, ...parsed }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

/** Persists UI prefs. Swallows storage errors (private-mode/quota) — onboarding state is non-critical. */
export function saveUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Non-critical: a failed write just means the splash may reappear next session.
  }
}
