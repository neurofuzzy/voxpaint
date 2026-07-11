import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'

/**
 * Lights live in a rig `<group>` synced to the camera's transform every frame, so the key light
 * always hits the model from the same on-screen direction as the camera orbits. The rig must stay
 * a normal child of the scene (NOT reparented onto the camera object itself, e.g. via
 * `createPortal(..., camera)`) — R3F's default camera is never added to the actual `scene` graph,
 * and three.js only collects active lights by traversing `scene`, so lights parented directly to
 * the camera are invisible to the renderer's lighting pass entirely (breaks ambient too, not just
 * directional — learned this the hard way). Directional light `position` is rig-local; each
 * light's default `target` (a bare Object3D, never added to the scene graph) stays at identity
 * matrix / world origin, so the beam direction is "rig-relative offset -> world origin", which is
 * what rotates the lighting along with the view while still aiming at the model.
 */
export function SceneLighting() {
  const camera = useThree((s) => s.camera)
  const rig = useRef<Group>(null!)

  useFrame(() => {
    rig.current.position.copy(camera.position)
    rig.current.quaternion.copy(camera.quaternion)
  })

  return (
    <group ref={rig}>
      {/* Slight base fill so unlit faces don't go pure black. */}
      <ambientLight color="#6a6a72" intensity={0.9} />
      {/* Directional lights only — no point light. Directional intensity has always been a plain,
          distance-independent multiplier (no falloff, no photometric/candela unit change across
          three.js versions, unlike point/spot lights), so it behaves predictably regardless of
          scene scale or camera distance. Canvas uses `flat` (NoToneMapping) so these numbers map
          linearly to on-screen brightness instead of being rolled off by ACES tone mapping. */}
      <directionalLight color="#ffffff" position={[8, 12, 6]} intensity={2.5} />
      <directionalLight color="#5a5a65" position={[-8, 5, -8]} intensity={1} />
    </group>
  )
}
