import { useAppStore } from '@/store/useAppStore'
import type { Axis, Orientation } from '@/engine/grid/types'

const ARMS: Array<{ axis: Axis; orientation: Orientation; position: [number, number, number]; color: string }> = [
  { axis: 'x', orientation: 1, position: [2.2, 0, 0], color: '#c9605a' },
  { axis: 'x', orientation: -1, position: [-2.2, 0, 0], color: '#7a3c39' },
  { axis: 'y', orientation: 1, position: [0, 2.2, 0], color: '#5c9b6e' },
  { axis: 'y', orientation: -1, position: [0, -2.2, 0], color: '#3a6046' },
  { axis: 'z', orientation: 1, position: [0, 0, 2.2], color: '#4a7ec9' },
  { axis: 'z', orientation: -1, position: [0, 0, -2.2], color: '#2f4f7a' },
]

/** Minimal central axis widget — click a cap to set the construction plane's axis + orientation. */
export function ConstructionPlaneGizmo() {
  const setPlaneAxisOrientation = useAppStore((s) => s.setPlaneAxisOrientation)
  const plane = useAppStore((s) => s.plane)

  return (
    <group>
      {ARMS.map((arm) => {
        const active = plane.axis === arm.axis && plane.orientation === arm.orientation
        return (
          <mesh
            key={`${arm.axis}${arm.orientation}`}
            position={arm.position}
            onClick={(e) => {
              e.stopPropagation()
              setPlaneAxisOrientation(arm.axis, arm.orientation)
            }}
          >
            <sphereGeometry args={[active ? 0.32 : 0.22, 16, 16]} />
            <meshStandardMaterial color={arm.color} emissive={active ? arm.color : '#000000'} emissiveIntensity={active ? 0.6 : 0} />
          </mesh>
        )
      })}
    </group>
  )
}
