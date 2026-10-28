import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { rigPivotOf } from '@/engine/rigging/types'
import { chainHasActiveTweens } from '@/engine/rigging/rigLoop'
import { gizmoRadiusForBox, parentChainMatrix, resolvePreviewPose } from '@/engine/rigging/pose'
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

  const box = rigBoxes.find((b) => b.id === selectedRigBoxId) ?? null
  const group = useRef<THREE.Group>(null)
  // Rings track the resolved preview — including a playing cycle — so they sit where the
  // joints are drawn. Written per frame like the other rig chrome; grabbing freezes the
  // cycle into the scratch first (see Viewport3D), so the drag math stays consistent.
  useFrame(() => {
    const g = group.current
    const st = useAppStore.getState()
    if (!g || st.mode !== 'animate') return
    const selected = st.rigBoxes.find((b) => b.id === st.selectedRigBoxId) ?? null
    if (!selected || chainHasActiveTweens(st.rigBoxes, selected)) return
    const now = performance.now() / 1000
    const cycleTime = st.cyclePlaying && st.poseCycle ? now - st.cycleStartedAt : null
    const preview = resolvePreviewPose(st.poses, st.stagedPoseId, st.poseRotations, st.poseCycle, cycleTime)
    const parent = parentChainMatrix(st.rigBoxes, preview, selected)
    const pivot = rigPivotOf(selected)
    g.position.set(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5).applyMatrix4(parent)
    g.quaternion.setFromRotationMatrix(parent)
  })
  const radius = useMemo(() => (box ? gizmoRadiusForBox(box) : 0), [box])

  // Posing needs a static tween frame: the rings and every drag path sample the
  // pose-only parent chain, so a tween anywhere up the chain hides them (the panel
  // explains how to mute tweens to pose again). A playing *pose* cycle is fine — grabs
  // freeze it into the scratch first.
  if (mode !== 'animate' || activeTool !== 'pose' || !box || chainHasActiveTweens(rigBoxes, box)) return null

  return (
    <group ref={group} matrixAutoUpdate={false}>
      {RING_AXES.map((axis) => (
        <mesh
          key={axis}
          rotation={RING_ROTATION[axis]}
          renderOrder={11}
          raycast={() => null}
        >
          <torusGeometry args={[radius, 0.06, 12, 72]} />
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
