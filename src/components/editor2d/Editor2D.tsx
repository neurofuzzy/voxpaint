import { ChevronLeft, ChevronRight, FlipHorizontal } from 'lucide-react'
import { FloatingPalette } from '@/components/panels/FloatingPalette'
import { useAppStore } from '@/store/useAppStore'
import { PixelCanvas } from './PixelCanvas'

export function Editor2D() {
  const plane = useAppStore((s) => s.plane)
  const setPlaneOffset = useAppStore((s) => s.setPlaneOffset)
  const setPlaneAxisOrientation = useAppStore((s) => s.setPlaneAxisOrientation)

  return (
    <div className="flex h-full min-w-0 flex-col bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs text-neutral-400">
        <span className="font-mono uppercase text-neutral-300">{plane.axis}</span>
        <span>{plane.orientation === 1 ? '+' : '−'}</span>
        <button
          className="rounded p-0.5 hover:bg-neutral-800"
          onClick={() => setPlaneAxisOrientation(plane.axis, plane.orientation === 1 ? -1 : 1)}
          aria-label="Flip plane orientation"
          title="Flip plane orientation"
        >
          <FlipHorizontal size={14} />
        </button>
        <div className="h-4 w-px bg-neutral-800" />
        <button
          className="rounded p-0.5 hover:bg-neutral-800"
          onClick={() => setPlaneOffset(plane.offset - 1)}
          aria-label="Decrease offset"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="w-10 text-center font-mono text-neutral-200">{plane.offset}</span>
        <button
          className="rounded p-0.5 hover:bg-neutral-800"
          onClick={() => setPlaneOffset(plane.offset + 1)}
          aria-label="Increase offset"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <PixelCanvas />
        <FloatingPalette />
      </div>
    </div>
  )
}
