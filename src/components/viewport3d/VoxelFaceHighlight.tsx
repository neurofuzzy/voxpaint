import { useMemo } from 'react'
import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import type { Axis } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'

const UP = new THREE.Vector3(0, 1, 0)
const AXIS_UNIT: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
}
const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

/** Nudges the highlight quad off the voxel's actual face surface (outward, along the face
 * normal) so it doesn't z-fight with the voxel mesh sitting at the exact same depth. */
const SURFACE_OFFSET = 0.01

/**
 * Live hover preview of the voxel face under the pointer (`hoveredFace`, updated on every
 * pointermove in Viewport3D.tsx — including between faces of the same voxel). A click commits
 * the construction plane to whichever face this is currently showing (handleVoxelFaceClick in
 * planeSlice.ts). Cells are corner-anchored ([n, n+1) per axis — see constructionPlane.ts), so
 * the face sits at coord+1 on the hovered axis for orientation 1, or at coord itself for -1.
 */
export function VoxelFaceHighlight() {
  const hoveredFace = useAppStore((s) => s.hoveredFace)

  const transform = useMemo(() => {
    if (!hoveredFace) return null
    const coord = decodeKey(hoveredFace.cellKey)
    const axisIndex = AXIS_INDEX[hoveredFace.axis]
    const position: [number, number, number] = [coord[0] + 0.5, coord[1] + 0.5, coord[2] + 0.5]
    position[axisIndex] = coord[axisIndex] + (hoveredFace.orientation === 1 ? 1 : 0) + hoveredFace.orientation * SURFACE_OFFSET
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, AXIS_UNIT[hoveredFace.axis])
    return { position, quaternion }
  }, [hoveredFace])

  if (!transform) return null

  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      <mesh rotation-x={-Math.PI / 2} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#f2c94c" transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
