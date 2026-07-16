import type { StateCreator } from 'zustand'
import { loadUiPrefs, saveUiPrefs } from '@/engine/persistence/uiPrefs'
import type { AppState, UiSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], UiSlice>

/**
 * Onboarding / chrome UI state that isn't part of the artwork: the first-run splash, the keyboard-
 * shortcuts help dialog, and the spotlight interface tour. Kept in the store (rather than local
 * component state) so any surface — a Help button, a `?` shortcut, or a future Tauri menu — can
 * open them, and so the splash's initial visibility is decided once from persisted prefs.
 */
export const createUiSlice: Slice = (set) => ({
  // First-run gate: show the splash unless the user previously ticked "Don't show again".
  splashOpen: !loadUiPrefs().dontShowSplash,
  helpOpen: false,
  tourActive: false,
  tourStep: 0,

  openSplash: () => set((s) => { s.splashOpen = true }),
  /** Closes the splash, persisting the "don't show again" choice when the user opted in. */
  closeSplash: (dontShowAgain: boolean) => {
    if (dontShowAgain) saveUiPrefs({ dontShowSplash: true })
    set((s) => { s.splashOpen = false })
  },

  openHelp: () => set((s) => { s.helpOpen = true }),
  closeHelp: () => set((s) => { s.helpOpen = false }),

  /** Starts the interface tour from the first step (also closes splash/help so nothing overlaps). */
  startTour: () => set((s) => {
    s.splashOpen = false
    s.helpOpen = false
    s.tourActive = true
    s.tourStep = 0
  }),
  endTour: () => set((s) => { s.tourActive = false }),
  tourNext: () => set((s) => { s.tourStep += 1 }),
  tourPrev: () => set((s) => { if (s.tourStep > 0) s.tourStep -= 1 }),
})
