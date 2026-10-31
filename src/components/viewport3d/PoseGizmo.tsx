import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { rigPivotOf } from '@/engine/rigging/types'
import { gizmoRadiusForBox, parentChainMatrix } from '@/engine/rigging/pose'
import { previewFrame } from '@/engine/rigging/preview'
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
 * show in every model view mode. Poses-mode only: in a tweens project the gizmo neither
 * renders nor accepts drags (see Viewport3D's press handling).
 */
export function PoseGizmo() {
  const mode = useAppStore((s) => s.mode)
  const animationMode = useAppStore((s) => s.meta.animationMode ?? 'tweens')
  const activeTool = useAppStore((s) => s.activeTool)
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)

  const box = rigBoxes.find((b) => b.id === selectedRigBoxId) ?? null
  const group = useRef<THREE.Group>(null)
  // Rings track the resolved preview — including a playing clip — so they sit where the
  // joints are drawn. Written per frame like the other rig chrome; grabbing freezes the
  // clip into the scratch first (see Viewport3D), so the drag math stays consistent.
  useFrame(() => {
    const g = group.current
    const st = useAppStore.getState()
    if (!g || st.mode !== 'animate' || (st.meta.animationMode ?? 'tweens') !== 'poses') return
    const selected = st.rigBoxes.find((b) => b.id === st.selectedRigBoxId) ?? null
    if (!selected) return
    const { pose: preview } = previewFrame(st, performance.now() / 1000)
    const parent = parentChainMatrix(st.rigBoxes, preview, selected)
    const pivot = rigPivotOf(selected)
    g.position.set(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5).applyMatrix4(parent)
    g.quaternion.setFromRotationMatrix(parent)
  })
  const radius = useMemo(() => (box ? gizmoRadiusForBox(box) : 0), [box])

  // A playing clip is fine — grabs freeze it into the scratch first.
  if (mode !== 'animate' || animationMode !== 'poses' || activeTool !== 'pose' || !box) return null

  return (
    <group ref={group}>
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
