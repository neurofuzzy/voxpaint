import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { DEFAULT_GRID_EXTENT } from '@/engine/grid/GridStore'
import type { BoxFace } from '@/engine/texture/types'
import { HALF_WORLD } from '@/engine/texture/types'
import { useAppStore } from '@/store/useAppStore'

const CLICK_DRAG_THRESHOLD_PX = 4
const SIZE = DEFAULT_GRID_EXTENT // 16 — the working-volume box edge

/** Each box face's flat pick/highlight quad: center position on the face + a rotation that lays a
 * `planeGeometry` (default +Z normal) into that face's plane. */
const FACES: { face: BoxFace; position: [number, number, number]; rotation: [number, number, number] }[] = [
  { face: 'px', position: [HALF_WORLD, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { face: 'nx', position: [-HALF_WORLD, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  { face: 'py', position: [0, HALF_WORLD, 0], rotation: [-Math.PI / 2, 0, 0] },
  { face: 'ny', position: [0, -HALF_WORLD, 0], rotation: [Math.PI / 2, 0, 0] },
  { face: 'pz', position: [0, 0, HALF_WORLD], rotation: [0, 0, 0] },
  { face: 'nz', position: [0, 0, -HALF_WORLD], rotation: [0, Math.PI, 0] },
]

/**
 * Texture-mode 3D interaction: an emissive wireframe box around the working volume whose 6 faces are
 * clickable to choose which box-map face the 2D canvas paints. Replaces voxel picking / the
 * construction plane in texture mode. A hovered face tints faintly; the active face tints brighter.
 * Click detection ignores orbit drags via a small pointer-move threshold.
 */
export function BoundingBoxFaceSelector() {
  const activeBoxFace = useAppStore((s) => s.activeBoxFace)
  const setActiveBoxFace = useAppStore((s) => s.setActiveBoxFace)
  const [hovered, setHovered] = useState<BoxFace | null>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)

  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(SIZE, SIZE, SIZE)), [])

  return (
    <group>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#38e6ff" toneMapped={false} transparent opacity={0.9} />
      </lineSegments>

      {FACES.map(({ face, position, rotation }) => {
        const opacity = activeBoxFace === face ? 0.3 : hovered === face ? 0.14 : 0
        return (
          <mesh
            key={face}
            position={position}
            rotation={rotation}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation()
              setHovered(face)
            }}
            onPointerOut={() => setHovered((h) => (h === face ? null : h))}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              downRef.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
            }}
            onPointerUp={(e: ThreeEvent<PointerEvent>) => {
              const down = downRef.current
              downRef.current = null
              if (!down) return
              if (Math.hypot(e.nativeEvent.clientX - down.x, e.nativeEvent.clientY - down.y) > CLICK_DRAG_THRESHOLD_PX) return
              setActiveBoxFace(face)
            }}
          >
            <planeGeometry args={[SIZE, SIZE]} />
            <meshBasicMaterial color="#38e6ff" transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}
