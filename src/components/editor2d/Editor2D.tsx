import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { PixelCanvas } from './PixelCanvas'

export function Editor2D() {
  const plane = useAppStore((s) => s.plane)
  const setPlaneOffset = useAppStore((s) => s.setPlaneOffset)

  return (
    <div className="flex h-full min-w-0 flex-col bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs text-neutral-400">
        <span className="font-mono uppercase text-neutral-300">{plane.axis}</span>
        <span>{plane.orientation === 1 ? '+' : '−'}</span>
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
        <span className="ml-auto text-neutral-600">shift+drag: straight line · right-drag: erase</span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <PixelCanvas />
      </div>
    </div>
  )
}
