import { decodeKey } from '@/engine/grid/GridStore'
import { encodeSliceKey } from '@/engine/animation/animationLayers'
import { useAppStore } from '@/store/useAppStore'

const PIVOT_COLOR = '#8b5cf6' // violet-500, matching the app's UI accent

/** Small marker at the current construction-plane slice's rotation/pendulum pivot, if one is set —
 * Animate mode only. Modeled on `ConstructionPlaneGizmo`'s sphere-with-emissive style. */
export function PivotGizmo() {
  const mode = useAppStore((s) => s.mode)
  const plane = useAppStore((s) => s.plane)
  const slicePivots = useAppStore((s) => s.slicePivots)

  if (mode !== 'animate') return null

  const pivotKey = slicePivots.get(encodeSliceKey(plane.axis, plane.offset))
  if (!pivotKey) return null

  const [x, y, z] = decodeKey(pivotKey)

  return (
    <mesh position={[x + 0.5, y + 0.5, z + 0.5]}>
      <sphereGeometry args={[0.25, 16, 16]} />
      <meshStandardMaterial color={PIVOT_COLOR} emissive={PIVOT_COLOR} emissiveIntensity={0.6} />
    </mesh>
  )
}
