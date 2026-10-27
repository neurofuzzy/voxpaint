import * as THREE from 'three'
import { useAppStore } from '@/store/useAppStore'
import { viewOriginShift } from '@/engine/grid/GridStore'
import type { Axis, Orientation } from '@/engine/grid/types'

const ARMS: Array<{ axis: Axis; orientation: Orientation; position: [number, number, number]; color: string; dim: string }> = [
  { axis: 'x', orientation: 1, position: [2.2, 0, 0], color: '#c9605a', dim: '#7a3c39' },
  { axis: 'x', orientation: -1, position: [-2.2, 0, 0], color: '#c9605a', dim: '#7a3c39' },
  { axis: 'y', orientation: 1, position: [0, 2.2, 0], color: '#5c9b6e', dim: '#3a6046' },
  { axis: 'y', orientation: -1, position: [0, -2.2, 0], color: '#5c9b6e', dim: '#3a6046' },
  { axis: 'z', orientation: 1, position: [0, 0, 2.2], color: '#4a7ec9', dim: '#2f4f7a' },
  { axis: 'z', orientation: -1, position: [0, 0, -2.2], color: '#4a7ec9', dim: '#2f4f7a' },
]

const AXES: Axis[] = ['x', 'y', 'z']

/** One shared segment per axis through the origin (±2.2, meeting the old cap spots). */
const axisGeos: Record<Axis, THREE.BufferGeometry> = (() => {
  const at = (axis: Axis) => {
    const verts = new Float32Array(6)
    const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    verts[i] = -2.2
    verts[i + 3] = 2.2
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    return g
  }
  return { x: at('x'), y: at('y'), z: at('z') }
})()

/** Minimal central axis widget: a thin 3-axis crosshair on the working origin. The viewing
 * axis arm renders bright, the others dim. Clicking near an arm end (invisible hit spheres,
 * same spots/sizes as the old caps) sets the construction plane's axis + orientation. */
export function ConstructionPlaneGizmo() {
  const setPlaneAxisOrientation = useAppStore((s) => s.setPlaneAxisOrientation)
  const plane = useAppStore((s) => s.plane)
  // Sit the central widget on the working origin — shifted half a cell for odd sizes so it marks the
  // center column rather than the even grid's corner.
  const shift = useAppStore((s) => viewOriginShift(s.meta.gridExtent))

  return (
    <group position={[shift, shift, shift]}>
      {AXES.map((axis) => {
        const arm = ARMS.find((a) => a.axis === axis)!
        const active = plane.axis === axis
        return (
          <lineSegments key={`axis-${axis}`} geometry={axisGeos[axis]} raycast={() => null}>
            <lineBasicMaterial color={active ? arm.color : arm.dim} toneMapped={false} transparent opacity={active ? 1 : 0.55} />
          </lineSegments>
        )
      })}
      {ARMS.map((arm) => (
        <mesh
          key={`${arm.axis}${arm.orientation}`}
          position={arm.position}
          onClick={(e) => {
            e.stopPropagation()
            setPlaneAxisOrientation(arm.axis, arm.orientation)
          }}
        >
          <sphereGeometry args={[0.32, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}
