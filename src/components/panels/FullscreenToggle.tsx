import { Maximize, Minimize } from 'lucide-react'
import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'

export function FullscreenToggle() {
  const fullscreen = useAppStore((s) => s.fullscreen)
  const setFullscreen = useAppStore((s) => s.setFullscreen)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [setFullscreen])

  function toggle() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      onPointerEnter={() => setStatusMessage(fullscreen ? 'Exit fullscreen mode' : 'Enter fullscreen mode')}
      onPointerLeave={() => setStatusMessage(null)}
      className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
    >
      {fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
    </button>
  )
}
