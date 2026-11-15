import { useMemo } from 'react'
import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import { boxWorld, faceHitBits, gridBoxAtBits, WHOLE_BOX } from '@/engine/grid/cellBox'
import { axisIndex, flushFaceValue } from '@/engine/plane/planeGeometry'
import { useAppStore } from '@/store/useAppStore'
import { AXIS_UNIT_VECTOR } from './axisVectors'

/** Nudges the highlight quad off the voxel's actual face surface (outward, along the face
 * normal) so it doesn't z-fight with the voxel mesh sitting at the exact same depth. */
const SURFACE_OFFSET = 0.01

/**
 * Live hover preview of the voxel face under the pointer (`hoveredFace`, updated on every
 * pointermove in Viewport3D.tsx — including between faces of the same voxel). A click commits
 * the construction plane to whichever face this is currently showing (handleVoxelFaceClick in
 * planeSlice.ts). With a grid armed the highlight is the face of the grid cell under the hit
 * point — exactly what a 3D erase/recolor tap addresses (`gridBoxAtBits`); 2D-mirrored hovers
 * carry no hit point and highlight the whole face.
 */
export function VoxelFaceHighlight() {
  const hoveredFace = useAppStore((s) => s.hoveredFace)
  const gridSplit = useAppStore((s) => s.gridSplit)

  const transform = useMemo(() => {
    if (!hoveredFace) return null
    const coord = decodeKey(hoveredFace.cellKey)
    const i = axisIndex(hoveredFace.axis)
    const point = hoveredFace.point
    const box = point ? gridBoxAtBits(gridSplit, faceHitBits(point, coord, hoveredFace.axis, hoveredFace.orientation)) : WHOLE_BOX
    const { origin, size } = boxWorld(coord, box)
    const position: [number, number, number] = [origin[0] + size[0] / 2, origin[1] + size[1] / 2, origin[2] + size[2] / 2]
    // Depth: the hit surface itself (detail faces can sit inside the voxel), else the voxel face.
    position[i] = (point ? point[i] : flushFaceValue(coord[i], hoveredFace.orientation)) + hoveredFace.orientation * SURFACE_OFFSET
    // Deterministic tangent basis (X → first in-plane axis, Y → second, Z → outward
    // normal), so non-square footprints orient exactly; the plane geometry spans local X/Y.
    const iAxis = hoveredFace.axis
    const axes = (['x', 'y', 'z'] as const).filter((a) => a !== iAxis)
    const n = AXIS_UNIT_VECTOR[iAxis].clone().multiplyScalar(hoveredFace.orientation)
    const tU = new THREE.Vector3()
    tU.setComponent(axisIndex(axes[0]), 1)
    const tV = new THREE.Vector3().crossVectors(n, tU)
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tU, tV, n))
    return { position, quaternion, su: size[axisIndex(axes[0])], sv: size[axisIndex(axes[1])] }
  }, [hoveredFace, gridSplit])

  if (!transform) return null

  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      <mesh raycast={() => null}>
        <planeGeometry args={[transform.su, transform.sv]} />
        <meshBasicMaterial color="#f2c94c" transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
