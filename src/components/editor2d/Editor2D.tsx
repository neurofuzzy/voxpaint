import { useRef } from 'react'
import { FloatingPalette } from '@/components/panels/FloatingPalette'
import { usePlaneLayerScroll } from '@/components/usePlaneLayerScroll'
import { useAppStore } from '@/store/useAppStore'
import { PixelCanvas } from './PixelCanvas'
import { PlaneControlsOverlay } from './PlaneControlsOverlay'
import { TextureCanvas } from './TextureCanvas'
import { TextureOverlay } from './TextureOverlay'

export function Editor2D() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mode = useAppStore((s) => s.mode)
  usePlaneLayerScroll(containerRef)

  return (
    <div ref={containerRef} className="flex h-full min-w-0 flex-col bg-neutral-950">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {mode === 'texture' ? (
          <>
            <TextureCanvas />
            <TextureOverlay />
          </>
        ) : (
          <>
            <PixelCanvas />
            <PlaneControlsOverlay />
          </>
        )}
        <FloatingPalette />
      </div>
    </div>
  )
}
