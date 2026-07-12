import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'

/**
 * Shift + mouse wheel steps the construction-plane offset — the "layer" along the current axis —
 * up (+1) / down (−1), on whichever panel the pointer is over. Attaches a **capture-phase,
 * non-passive** wheel listener on `containerRef` so it runs before, and suppresses, the panel's own
 * wheel behaviour (OrbitControls zoom in the 3D view; canvas pan/zoom in the 2D editor) and can
 * `preventDefault`. Plain (unshifted) wheel is left entirely to those handlers.
 *
 * Shift+wheel commonly arrives as a horizontal delta (browsers remap the wheel axis while shift is
 * held), so the step direction reads from whichever of deltaY/deltaX is non-zero.
 */
export function usePlaneLayerScroll(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
      if (delta === 0) return
      const { plane, setPlaneOffset } = useAppStore.getState()
      setPlaneOffset(plane.offset + (delta < 0 ? 1 : -1))
    }

    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  }, [containerRef])
}
