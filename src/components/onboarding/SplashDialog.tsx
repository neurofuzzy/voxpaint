import * as Dialog from '@radix-ui/react-dialog'
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import logoUrl from '@/assets/logo.svg'
import { useAppStore } from '@/store/useAppStore'

/**
 * First-run welcome screen: the VoxPaint logo, large and centered, with a "Don't show again"
 * checkbox (persisted to localStorage via the ui slice) and a primary button that launches the
 * interface tour. Visibility is driven by `splashOpen`, which the ui slice seeds from persisted
 * prefs on load — so this appears automatically on a fresh visit and never again once dismissed.
 */
export function SplashDialog() {
  const open = useAppStore((s) => s.splashOpen)
  const closeSplash = useAppStore((s) => s.closeSplash)
  const startTour = useAppStore((s) => s.startTour)
  const [dontShow, setDontShow] = useState(false)

  // Reset the checkbox each time the splash opens (e.g. if reopened programmatically later).
  useEffect(() => {
    if (open) setDontShow(false)
  }, [open])

  function skip() {
    closeSplash(dontShow)
  }

  function takeTour() {
    // Persist the "don't show again" choice before the tour replaces the splash.
    closeSplash(dontShow)
    startTour()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) skip() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl
            border border-neutral-800 bg-neutral-900 p-8 text-neutral-200 shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="sr-only">Welcome to VoxPaint</Dialog.Title>
          <Dialog.Description className="sr-only">
            Welcome screen with an option to take a guided tour of the interface.
          </Dialog.Description>

          <div className="flex flex-col items-center text-center">
            <img src={logoUrl} alt="VoxPaint" className="h-16 w-auto drop-shadow-lg" />
            <p className="mt-6 max-w-sm text-sm text-neutral-400">
              Paint voxel models in 2D, watch them come together in 3D. New here? Take a quick tour
              of the interface.
            </p>

            <div className="mt-7 flex items-center gap-3">
              <button
                onClick={skip}
                className="rounded-md px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Skip
              </button>
              <button
                onClick={takeTour}
                className="flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
              >
                <Sparkles size={15} /> Take the tour
              </button>
            </div>

            <label className="mt-6 flex cursor-pointer items-center gap-2 text-xs text-neutral-500 select-none">
              <input
                type="checkbox"
                checked={dontShow}
                onChange={(e) => setDontShow(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-violet-500"
              />
              Don't show this again
            </label>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
