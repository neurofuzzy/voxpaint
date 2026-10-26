import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useAppStore } from '@/store/useAppStore'

const RIG_AMBER = 0xf59e0b
const RIG_ACTIVE = 0xc084fc
const FILL_OPACITY = 0.06
const FRAME_OPACITY = 0.55
const PAD = 0.03

/**
 * Renders every named rig bounding box as an amber wire box in the 3D view (Animate mode only):
 * the export-time mesh-naming overlay. Selected box highlights violet; raycast disabled so
 * boxes never intercept picking. Lives under Viewport3D's Y-scale group (grid coordinates).
 */
export function RigBoxHighlight() {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const isAnimate = useAppStore((s) => s.mode === 'animate')

  const shapes = useMemo(() => {
    return rigBoxes.map((box) => {
      const size: [number, number, number] = [
        box.max[0] - box.min[0] + 1 + PAD * 2,
        box.max[1] - box.min[1] + 1 + PAD * 2,
        box.max[2] - box.min[2] + 1 + PAD * 2,
      ]
      const center: [number, number, number] = [
        (box.min[0] + box.max[0] + 1) / 2,
        (box.min[1] + box.max[1] + 1) / 2,
        (box.min[2] + box.max[2] + 1) / 2,
      ]
      const geo = new THREE.BoxGeometry(...size)
      const edges = new THREE.EdgesGeometry(geo)
      return { id: box.id, geo, edges, center }
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

  if (!isAnimate || shapes.length === 0) return null

  return (
    <group>
      {shapes.map((s) => {
        const active = s.id === selectedRigBoxId
        const color = active ? RIG_ACTIVE : RIG_AMBER
        return (
          <group key={s.id} position={s.center}>
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
            <lineSegments geometry={s.edges} raycast={() => null}>
              <lineBasicMaterial
                color={color}
                toneMapped={false}
                transparent
                opacity={active ? 1 : FRAME_OPACITY}
                depthWrite={false}
              />
            </lineSegments>
          </group>
        )
      })}
    </group>
  )
}
