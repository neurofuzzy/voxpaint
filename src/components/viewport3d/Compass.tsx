import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Navigation2 } from 'lucide-react'
import { useRef } from 'react'
import * as THREE from 'three'

export function Compass() {
  const camera = useThree((s) => s.camera)
  const iconRef = useRef<HTMLDivElement>(null)

  useFrame(() => {
    const heading = Math.atan2(camera.position.x, camera.position.z)
    const deg = -THREE.MathUtils.radToDeg(heading)
    if (iconRef.current) iconRef.current.style.transform = `rotate(${deg}deg)`
  })

  return (
    <Html fullscreen style={{ pointerEvents: 'none' }}>
      <div className="pointer-events-none absolute left-5 top-5 z-40 select-none">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800/50 shadow ring-1 ring-white/10 backdrop-blur-sm text-neutral-300">
          <div ref={iconRef} style={{ willChange: 'transform' }}>
            <Navigation2 size={14} fill="currentColor" />
          </div>
        </div>
      </div>
    </Html>
  )
}
