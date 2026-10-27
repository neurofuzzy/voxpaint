import { useMemo } from 'react'
import * as THREE from 'three'
import { rigPivotOf } from '@/engine/rigging/types'
import { isLoopActive } from '@/engine/rigging/rigLoop'
import { gizmoRadiusForBox, parentChainMatrix } from '@/engine/rigging/pose'
import type { Axis } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'

const RING_COLORS: Record<Axis, string> = {
  x: '#f87171',
  y: '#4ade80',
  z: '#60a5fa',
}

/** Torus base orientation per ring (three's torus lies in XY, i.e. around Z). */
const RING_ROTATION: Record<Axis, [number, number, number]> = {
  x: [0, Math.PI / 2, 0],
  y: [Math.PI / 2, 0, 0],
  z: [0, 0, 0],
}

const RING_AXES: Axis[] = ['x', 'y', 'z']

/**
 * Animate-mode pose gizmo (Pose tool only — this is the 3D manipulation mode): three
 * rotation rings around the selected box's pivot, drawn in the parent-joint frame (bind
 * position/orientation for roots). Rings are pure chrome — hit-testing happens in screen
 * space from the same transform (see `nearestRingHit`), so what you see is what's
 * grabbable. They read through geometry (depthTest off) like the other rig chrome, and
 * show in every model view mode.
 */
export function PoseGizmo() {
  const mode = useAppStore((s) => s.mode)
  const activeTool = useAppStore((s) => s.activeTool)
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const poseRotations = useAppStore((s) => s.poseRotations)

  const box = rigBoxes.find((b) => b.id === selectedRigBoxId) ?? null
  // Hook order must stay stable — compute the transform memo unconditionally.
  const transform = useMemo(() => {
    if (!box) return null
    const parent = parentChainMatrix(rigBoxes, poseRotations, box)
    const pivot = rigPivotOf(box)
    const position = new THREE.Vector3(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5).applyMatrix4(parent)
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(parent)
    return { position, quaternion, radius: gizmoRadiusForBox(box) }
  }, [box, rigBoxes, poseRotations])

  // Looped joints are driven by their cycle, not the gizmo — posing one is a no-op,
  // so the rings hide (the inspector explains how to clear the loop to pose again).
  if (mode !== 'animate' || activeTool !== 'pose' || !box || !transform || isLoopActive(box.loop)) return null

  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      {RING_AXES.map((axis) => (
        <mesh
          key={axis}
          rotation={RING_ROTATION[axis]}
          renderOrder={11}
          raycast={() => null}
        >
          <torusGeometry args={[transform.radius, 0.06, 12, 72]} />
          <meshStandardMaterial
            color={RING_COLORS[axis]}
            emissive={RING_COLORS[axis]}
            emissiveIntensity={0.9}
            depthTest={false}
            transparent
            opacity={0.95}
          />
        </mesh>
      ))}
    </group>
  )
}
