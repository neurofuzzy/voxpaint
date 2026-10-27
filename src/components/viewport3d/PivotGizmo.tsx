import { decodeKey } from '@/engine/grid/GridStore'
import { encodeSliceKey } from '@/engine/animation/animationLayers'
import { rigPivotOf } from '@/engine/rigging/types'
import { useAppStore } from '@/store/useAppStore'

const PIVOT_COLOR = '#8b5cf6' // violet-500, matching the app's UI accent
const RIG_PIVOT_COLOR = '#ffffff' // white, matching the selected rig box's outline
const RIG_PIVOT_DIM = '#f59e0b' // amber-500, matching unselected rig box outlines

/**
 * Animate-mode pivot markers (under Viewport3D's Y-scale group, so grid coordinates in):
 * - a violet sphere at the current construction-plane slice's rotation/pendulum pivot, if set
 * - one sphere per rig box at its rotation center, colored like its bounding-box outline
 *   (white when selected, amber otherwise) — all drawn on top of geometry via depthTest-off
 *   rendering, like the selected box's outline
 * Null when none apply.
 */
export function PivotGizmo() {
  const mode = useAppStore((s) => s.mode)
  const plane = useAppStore((s) => s.plane)
  const slicePivots = useAppStore((s) => s.slicePivots)
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  // Isolate mode shows only the selected box's pivot, matching its wire box.
  const isolating = useAppStore((s) => s.isolateRig)

  if (mode !== 'animate') return null

  const pivotKey = slicePivots.get(encodeSliceKey(plane.axis, plane.offset))
  if (!pivotKey && rigBoxes.length === 0) return null
  const shownBoxes = isolating ? rigBoxes.filter((b) => b.id === selectedRigBoxId) : rigBoxes
  if (!pivotKey && shownBoxes.length === 0) return null

  const slicePivot = pivotKey ? decodeKey(pivotKey) : null

  return (
    <group>
      {slicePivot && (
        <mesh position={[slicePivot[0] + 0.5, slicePivot[1] + 0.5, slicePivot[2] + 0.5]}>
          <sphereGeometry args={[0.25, 16, 16]} />
          <meshStandardMaterial color={PIVOT_COLOR} emissive={PIVOT_COLOR} emissiveIntensity={0.6} />
        </mesh>
      )}
      {shownBoxes.map((box) => {
        const active = box.id === selectedRigBoxId
        const pivot = rigPivotOf(box)
        const color = active ? RIG_PIVOT_COLOR : RIG_PIVOT_DIM
        return (
          <mesh
            key={box.id}
            position={[pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5]}
            raycast={() => null}
            renderOrder={10}
          >
            <sphereGeometry args={[active ? 0.28 : 0.22, 16, 16]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.8}
              depthTest={false}
              transparent
              opacity={0.95}
            />
          </mesh>
        )
      })}
    </group>
  )
}
