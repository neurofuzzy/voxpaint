import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildRigBoxWireGeometry, composePoseMatrices } from '@/engine/rigging/pose'
import { useAppStore } from '@/store/useAppStore'

const RIG_AMBER = 0xf59e0b
const RIG_ACTIVE = 0xffffff
const FILL_OPACITY = 0.06
const FRAME_OPACITY = 0.55
const IDENTITY = new THREE.Matrix4()

/**
 * Renders every named rig bounding box as an amber wire box in the 3D view (Animate mode only).
 * The selected box draws white outlines rendered on top of the model so list selection is
 * unmistakable. Boxes ride the pose: geometry is built pivot-relative and each group's
 * transform is the box's composed pose matrix (identity at bind), so outlines bound the
 * posed voxels exactly. Display only — Animate mode never edits in 3D, so raycast stays
 * disabled and taps fall through to rig selection. Lives under Viewport3D's Y-scale group
 * (grid coordinates).
 */
export function RigBoxHighlight() {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const isAnimate = useAppStore((s) => s.mode === 'animate')
  // Isolate mode shows only the selected box — every other box's chrome hides with its voxels.
  const isolating = useAppStore((s) => s.isolateRig)
  // Re-render on pose changes: chrome is a handful of line segments, so declarative
  // position/quaternion per box is cheaper than the imperative matrix plumbing the heavy
  // model views need.
  const poseRotations = useAppStore((s) => s.poseRotations)

  const shapes = useMemo(() => {
    return rigBoxes.map((box) => {
      const { geometry, edges } = buildRigBoxWireGeometry(box)
      return { id: box.id, geo: geometry, edges }
    })
  }, [rigBoxes])

  const matrices = useMemo(
    () => composePoseMatrices(rigBoxes, poseRotations),
    [rigBoxes, poseRotations],
  )

  useEffect(
    () => () => {
      for (const s of shapes) {
        s.geo.dispose()
        s.edges.dispose()
      }
    },
    [shapes],
  )

  if (!isAnimate || shapes.length === 0) return null
  const shown = isolating ? shapes.filter((s) => s.id === selectedRigBoxId) : shapes
  if (shown.length === 0) return null

  return (
    <group>
      {shown.map((s) => {
        const active = s.id === selectedRigBoxId
        const color = active ? RIG_ACTIVE : RIG_AMBER
        const m = matrices.get(s.id) ?? IDENTITY
        const position = new THREE.Vector3().setFromMatrixPosition(m)
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(m)
        return (
          <group key={s.id} position={position} quaternion={quaternion}>
            <mesh geometry={s.geo} raycast={() => null}>
              <meshBasicMaterial
                color={color}
                toneMapped={false}
                transparent
                opacity={active ? FILL_OPACITY * 2 : FILL_OPACITY}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
            <lineSegments geometry={s.edges} raycast={() => null} renderOrder={active ? 10 : 0}>
              <lineBasicMaterial
                color={color}
                toneMapped={false}
                transparent
                opacity={active ? 1 : FRAME_OPACITY}
                depthWrite={false}
                depthTest={active ? false : true}
              />
            </lineSegments>
          </group>
        )
      })}
    </group>
  )
}
