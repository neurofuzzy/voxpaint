import { useRef } from 'react'
import { X } from 'lucide-react'
import { FloatingPalette } from '@/components/panels/FloatingPalette'
import { MarkersPanel } from '@/components/panels/MarkersPanel'
import { usePlaneLayerScroll } from '@/components/usePlaneLayerScroll'
import { useAppStore } from '@/store/useAppStore'
import { PixelCanvas } from './PixelCanvas'
import { TextureCanvas } from './TextureCanvas'
import { TextureOverlay } from './TextureOverlay'

/**
 * The 2D editor pane. The X button top-right collapses the pane into the slim `CollapsedRail`
 * (3D-only modeling, auto-enabling 3D Edit — see MainLayout). It sits below the texture overlay
 * in Texture mode, where the top-right slot is already taken.
 */
export function Editor2D({ onCollapse }: { onCollapse: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mode = useAppStore((s) => s.mode)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  usePlaneLayerScroll(containerRef)

  return (
    <div ref={containerRef} data-tour="editor2d" className="flex h-full min-w-0 flex-col bg-neutral-950">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {mode === 'texture' ? (
          <>
            <TextureCanvas />
            <TextureOverlay />
          </>
        ) : mode === 'animate' ? (
          <PixelCanvas />
        ) : (
          <>
            <PixelCanvas />
            <MarkersPanel />
          </>
        )}
        <FloatingPalette />
        <button
          onClick={onCollapse}
          aria-label="Collapse 2D editor"
          title="Collapse the 2D editor (3D-only mode)"
          onPointerEnter={() => setStatusMessage('Collapse the 2D editor — full-width 3D modeling (auto-enables 3D Edit)')}
          onPointerLeave={() => setStatusMessage(null)}
          className={
            'absolute right-3 z-40 flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 ' +
            'bg-neutral-900/80 text-neutral-400 shadow-2xl backdrop-blur-lg hover:bg-neutral-800 hover:text-neutral-100 ' +
            (mode === 'texture' ? 'top-[4.5rem]' : 'top-3')
          }
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
