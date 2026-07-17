import { useFrame, useThree } from '@react-three/fiber'
import { Navigation2 } from 'lucide-react'
import type { RefObject } from 'react'
import * as THREE from 'three'

/**
 * Headless — lives inside `<Canvas>` purely to read the camera each frame and write the compass
 * needle's rotation directly to the DOM node rendered by `CompassIcon` (outside the Canvas).
 * Kept separate from `CompassIcon` rather than using drei's `<Html>` because `<Html>` content is
 * appended into the Canvas's own DOM subtree as a sibling of the live-updating WebGL `<canvas>`,
 * which some browsers promote to its own compositing layer that paints over ordinary DOM content
 * (dialogs, the intro screen) regardless of z-index. Writing to a ref instead keeps the compass in
 * normal DOM stacking order alongside the viewport's other overlays.
 */
export function CompassTracker({ iconRef }: { iconRef: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera)

  useFrame(() => {
    const heading = Math.atan2(camera.position.x, camera.position.z)
    const deg = -THREE.MathUtils.radToDeg(heading)
    if (iconRef.current) iconRef.current.style.transform = `rotate(${deg}deg)`
  })

  return null
}

/** Plain DOM overlay — render as a sibling of `<Canvas>`, not inside it (see `CompassTracker`). */
export function CompassIcon({ iconRef }: { iconRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="pointer-events-none absolute left-5 top-5 z-40 select-none">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800/50 shadow ring-1 ring-white/10 backdrop-blur-sm text-neutral-300">
        <div ref={iconRef} style={{ willChange: 'transform' }}>
          <Navigation2 size={14} fill="currentColor" />
        </div>
      </div>
    </div>
  )
}
