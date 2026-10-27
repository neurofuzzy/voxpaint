/**
 * App-level UI preferences, persisted outside the project autosave slot (they're about the app,
 * not the artwork). Same namespaced-key + try/catch pattern as `autosave.ts`, but intentionally
 * separate storage so clearing a project never wipes onboarding state.
 */
import type { Axis, Orientation } from '@/engine/grid/types'

const UI_PREFS_KEY = 'voxpaint:ui-prefs:v1'

/** The construction-plane pose as persisted: axis + orientation + layer offset. */
export type SavedPlane = { axis: Axis; orientation: Orientation; offset: number }

export type UiPrefs = {
  /** True once the user has ticked "Don't show again" on the splash screen. */
  dontShowSplash: boolean
  /** Persisted pane layout (2D/3D split vs 3D-only). Optional so pre-existing stored prefs
   * without the key still parse; absent/invalid reads as 'split'. */
  layoutMode?: 'split' | '3d-only'
  /** The layout Model mode uses. Recorded on every Model-mode layout change and restored when
   * returning to Model (Animate/Texture pin the live layout to split without touching this).
   * Absent/invalid falls back to `layoutMode`. */
  modelLayout?: 'split' | '3d-only'
  /** Persisted construction-plane pose (axis/orientation/offset). Written on every plane
   * change so a refresh keeps the current slice; cleared back to the grounded default by
   * project switches (new/import reset it — one project's slice must never leak into the
   * next). Absent/invalid reads as unset (the store default applies). */
  plane?: SavedPlane
  /** Animate-mode model visibility (full/ghost/hidden). Pure view chrome — absent/invalid
   * reads as 'full'. */
  animateModelView?: 'full' | 'ghost' | 'hidden'
}

const DEFAULT_UI_PREFS: UiPrefs = { dontShowSplash: false }

/** Reads persisted UI prefs, falling back to defaults on any missing/corrupt/unavailable storage. */
export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return { ...DEFAULT_UI_PREFS }
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    const prefs: UiPrefs = { ...DEFAULT_UI_PREFS, ...parsed }
    // Sanitize: only the two known layout values survive (hand-edited/corrupt storage falls back).
    if (prefs.layoutMode !== 'split' && prefs.layoutMode !== '3d-only') delete prefs.layoutMode
    if (prefs.modelLayout !== 'split' && prefs.modelLayout !== '3d-only') delete prefs.modelLayout
    // Same for the animate model view: only the three known modes survive.
    if (prefs.animateModelView !== 'full' && prefs.animateModelView !== 'ghost' && prefs.animateModelView !== 'hidden') {
      delete prefs.animateModelView
    }
    // Sanitize the plane the same way: known axes, ±1 orientations, integer offsets only.
    const p = parsed.plane
    if (
      p &&
      (p.axis === 'x' || p.axis === 'y' || p.axis === 'z') &&
      (p.orientation === 1 || p.orientation === -1) &&
      Number.isInteger(p.offset)
    ) {
      prefs.plane = { axis: p.axis, orientation: p.orientation, offset: p.offset }
    } else {
      delete prefs.plane
    }
    return prefs
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

/** Persists the construction-plane pose (read-modify-write so unrelated prefs survive). */
export function savePlanePref(plane: SavedPlane): void {
  saveUiPrefs({ ...loadUiPrefs(), plane: { ...plane } })
}
