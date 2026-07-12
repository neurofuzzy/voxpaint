import { Image, ImageOff } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

const BTN_BASE = 'flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
const BTN_ON = 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/25 hover:text-violet-200'

/**
 * Frosted overlay pinned to the top-right of the texture 2D editor, matching the style of
 * PlaneControlsOverlay and ViewOptionsOverlay. Currently holds the onion-skin toggle (show/hide
 * the 3D model projection behind the texel grid).
 */
export function TextureOverlay() {
  const onionSkin = useAppStore((s) => s.onionSkin)
  const setOnionSkin = useAppStore((s) => s.setOnionSkin)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  return (
    <div className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg">
      <button
        onClick={() => setOnionSkin(!onionSkin)}
        aria-label={onionSkin ? 'Hide onion skin' : 'Show onion skin'}
        aria-pressed={onionSkin}
        onPointerEnter={() => setStatusMessage('Toggle the 3D model silhouette guide behind the texture grid')}
        onPointerLeave={() => setStatusMessage(null)}
        className={`${BTN_BASE} ${onionSkin ? BTN_ON : ''}`}
      >
        {onionSkin ? <Image size={16} /> : <ImageOff size={16} />}
      </button>
    </div>
  )
}
