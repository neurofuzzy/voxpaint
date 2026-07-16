import { useEffect, useLayoutEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { TOUR_STEPS, type TourPlacement } from './tourSteps'

const HIGHLIGHT_PAD = 8
const CALLOUT_GAP = 14
const CARD_WIDTH = 320
const CARD_EST_HEIGHT = 190

type Rect = { top: number; left: number; width: number; height: number }

/** Where to float the callout card, given the highlighted rect and preferred placement. Clamps to
 * the viewport so the card is always fully visible even for edge/corner targets. */
function calloutStyle(rect: Rect, placement: TourPlacement): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampX = (x: number) => Math.max(8, Math.min(x, vw - CARD_WIDTH - 8))
  const clampY = (y: number) => Math.max(8, Math.min(y, vh - CARD_EST_HEIGHT - 8))
  const centerX = clampX(rect.left + rect.width / 2 - CARD_WIDTH / 2)
  const centerY = clampY(rect.top + rect.height / 2 - CARD_EST_HEIGHT / 2)

  switch (placement) {
    case 'bottom':
      return { top: rect.top + rect.height + HIGHLIGHT_PAD + CALLOUT_GAP, left: centerX }
    case 'top':
      return { top: Math.max(8, rect.top - HIGHLIGHT_PAD - CALLOUT_GAP - CARD_EST_HEIGHT), left: centerX }
    case 'right':
      return { top: centerY, left: clampX(rect.left + rect.width + HIGHLIGHT_PAD + CALLOUT_GAP) }
    case 'left':
      return { top: centerY, left: clampX(rect.left - HIGHLIGHT_PAD - CALLOUT_GAP - CARD_WIDTH) }
  }
}

/**
 * The spotlight interface tour: dims the whole app and rings one real UI region at a time (anchored
 * via `data-tour` attributes — see tourSteps.ts), with a floating Next/Back/Skip callout. Renders
 * nothing unless `tourActive`. Reads the live bounding rect of each step's target on step change and
 * on resize/scroll, so it tracks the actual layout rather than hard-coded coordinates. If a target
 * is ever missing it advances past it (or ends on the last step). Escape ends the tour.
 */
export function InterfaceTour() {
  const active = useAppStore((s) => s.tourActive)
  const step = useAppStore((s) => s.tourStep)
  const next = useAppStore((s) => s.tourNext)
  const prev = useAppStore((s) => s.tourPrev)
  const end = useAppStore((s) => s.endTour)
  const [rect, setRect] = useState<Rect | null>(null)

  const current = TOUR_STEPS[step]
  const isLast = step >= TOUR_STEPS.length - 1

  // Measure the current target; advance past a missing one so the tour never gets stuck on a
  // step whose element isn't mounted.
  useLayoutEffect(() => {
    if (!active) return
    if (!current) {
      end()
      return
    }
    function measure() {
      const el = document.querySelector(`[data-tour="${current.target}"]`)
      if (!el) {
        if (isLast) end()
        else next()
        return
      }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [active, current, isLast, next, end])

  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); end() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, end])

  if (!active || !current || !rect) return null

  return (
    <>
      {/* Transparent click-catcher: this top-layer fixed div blocks interaction with the app
          behind it while the tour runs (the callout card sits above it at a higher z-index). */}
      <div className="fixed inset-0" style={{ zIndex: 60 }} />

      {/* Spotlight: the box-shadow dims everything outside this rect and draws the violet ring. */}
      <div
        className="pointer-events-none fixed rounded-xl transition-all duration-200"
        style={{
          zIndex: 60,
          top: rect.top - HIGHLIGHT_PAD,
          left: rect.left - HIGHLIGHT_PAD,
          width: rect.width + HIGHLIGHT_PAD * 2,
          height: rect.height + HIGHLIGHT_PAD * 2,
          boxShadow: '0 0 0 2px rgba(139,92,246,0.9), 0 0 0 9999px rgba(0,0,0,0.65)',
        }}
      />

      {/* Callout card. */}
      <div
        className="fixed w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-neutral-200 shadow-2xl"
        style={{ zIndex: 61, ...calloutStyle(rect, current.placement) }}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-neutral-100">{current.title}</h3>
          <span className="font-mono text-[11px] tabular-nums text-neutral-500">
            {step + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">{current.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={end}
            className="rounded-md px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="rounded-md px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? end() : next())}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
