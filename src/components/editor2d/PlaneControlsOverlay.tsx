import { ChevronDown, ChevronUp } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

const BTN = 'flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'

/**
 * Frosted overlay pinned to the top-right of the 2D editor, mirroring the 3D preview's
 * ViewOptionsOverlay style. Steps the construction-plane offset (up = +1, down = −1), with the
 * current offset shown between the arrows. Axis + orientation control lives on the 3D overlay.
 */
export function PlaneControlsOverlay() {
  const plane = useAppStore((s) => s.plane)
  const setPlaneOffset = useAppStore((s) => s.setPlaneOffset)

  return (
    <div className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg">
      <button className={BTN} onClick={() => setPlaneOffset(plane.offset - 1)} aria-label="Decrease offset" title="Decrease offset">
        <ChevronDown size={16} />
      </button>
      <span className="w-8 text-center font-mono text-xs tabular-nums text-neutral-200" title="Plane offset">
        {plane.offset}
      </span>
      <button className={BTN} onClick={() => setPlaneOffset(plane.offset + 1)} aria-label="Increase offset" title="Increase offset">
        <ChevronUp size={16} />
      </button>
    </div>
  )
}
