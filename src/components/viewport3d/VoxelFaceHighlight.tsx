import { useMemo } from 'react'
import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import { splitChildBits, splitChildSize } from '@/engine/grid/subdiv'
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
 * planeSlice.ts). Cells are corner-anchored ([n, n+1) per axis — see constructionPlane.ts), so
 * the face sits at coord+1 on the hovered axis for orientation 1, or at coord itself for -1.
 */
export function VoxelFaceHighlight() {
  const hoveredFace = useAppStore((s) => s.hoveredFace)

  const transform = useMemo(() => {
    if (!hoveredFace) return null
    const coord = decodeKey(hoveredFace.cellKey)
    const i = axisIndex(hoveredFace.axis)
    const position: [number, number, number] = [coord[0] + 0.5, coord[1] + 0.5, coord[2] + 0.5]
    position[i] = flushFaceValue(coord[i], hoveredFace.orientation) + hoveredFace.orientation * SURFACE_OFFSET
    // Detail hits highlight just the hovered child: shrink to its in-plane footprint and
    // shift the in-plane center into the child's quadrant.
    let su = 1
    let sv = 1
    if (hoveredFace.childIndex !== undefined && hoveredFace.childIndex !== null) {
      const sub = useAppStore.getState().model.subdiv.get(hoveredFace.cellKey)
      const split = sub?.split ?? (['x', 'y', 'z'] as const)
      const [dx, dy, dz] = splitChildBits([...split], hoveredFace.childIndex)
      const [sx, sy, sz] = splitChildSize([...split])
      const off = [dx, dy, dz]
      const dims = [sx, sy, sz]
      su = 1
      sv = 1
      let k = 0
      for (let j = 0; j < 3; j++) {
        if (j === i) continue
        position[j] = coord[j] + off[j] * dims[j] + dims[j] / 2
        if (k === 0) su = dims[j]
        else sv = dims[j]
        k++
      }
    }
    // Deterministic tangent basis (X → first in-plane axis, Y → second, Z → outward
    // normal), so non-square child footprints orient exactly; the mesh needs no baked
    // rotation since the plane geometry already spans local X/Y facing +Z.
    const iAxis = hoveredFace.axis
    const axes = (['x', 'y', 'z'] as const).filter((a) => a !== iAxis)
    const n = AXIS_UNIT_VECTOR[iAxis].clone().multiplyScalar(hoveredFace.orientation)
    const tU = new THREE.Vector3()
    tU.setComponent(axisIndex(axes[0]), 1)
    const tV = new THREE.Vector3().crossVectors(n, tU)
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tU, tV, n))
    return { position, quaternion, su, sv }
  }, [hoveredFace])

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
