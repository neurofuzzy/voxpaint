import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { buildRigBoxWireGeometry } from '@/engine/rigging/pose'
import { composeAnimatedMatrices } from '@/engine/rigging/rigLoop'
import { useAppStore } from '@/store/useAppStore'

const RIG_AMBER = 0xf59e0b
const RIG_ACTIVE = 0xffffff
const FILL_OPACITY = 0.06
const FRAME_OPACITY = 0.55

/**
 * Renders every named rig bounding box as an amber wire box in the 3D view (Animate mode only).
 * The selected box draws white outlines rendered on top of the model so list selection is
 * unmistakable. Outlines ride full animation (tween stacks × pose) via the same composed
 * world matrices the voxel meshes use — written per frame straight into the scene graph,
 * so the boxes bound the animated voxels exactly with zero React re-renders. Display only
 * — Animate mode never edits in 3D, so raycast stays disabled and taps fall through to
 * rig selection. Lives under Viewport3D's Y-scale group (grid coordinates).
 */
export function RigBoxHighlight() {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const isAnimate = useAppStore((s) => s.mode === 'animate')
  // Isolate mode shows only the selected box — every other box's chrome hides with its voxels.
  const isolating = useAppStore((s) => s.isolateRig)
  const groups = useRef(new Map<string, THREE.Group>())

  const shapes = useMemo(() => {
    return rigBoxes.map((box) => {
      const { geometry, edges } = buildRigBoxWireGeometry(box)
      return { id: box.id, geo: geometry, edges }
    })
  }, [rigBoxes])

  useEffect(
    () => () => {
      for (const s of shapes) {
        s.geo.dispose()
        s.edges.dispose()
      }
    },
    [shapes],
  )

  // Same per-frame matrix plumbing as RigPoseView: the group transform IS the box's
  // composed world matrix (absolute→absolute — geometry is built in absolute grid
  // coordinates, so no recentering).
  useFrame(() => {
    const st = useAppStore.getState()
    if (st.mode !== 'animate') return
    const matrices = composeAnimatedMatrices(st.rigBoxes, st.poseRotations, performance.now() / 1000)
    for (const [id, group] of groups.current) {
      const m = matrices.get(id)
      if (!m) continue
      group.matrix.copy(m)
      group.matrixWorldNeedsUpdate = true
    }
  })

  if (!isAnimate || shapes.length === 0) return null
  const shown = isolating ? shapes.filter((s) => s.id === selectedRigBoxId) : shapes
  if (shown.length === 0) return null

  return (
    <group>
      {shown.map((s) => {
        const active = s.id === selectedRigBoxId
        const color = active ? RIG_ACTIVE : RIG_AMBER
        return (
          <group
            key={s.id}
            matrixAutoUpdate={false}
            ref={(g) => {
              if (g) groups.current.set(s.id, g)
              else groups.current.delete(s.id)
            }}
          >
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
