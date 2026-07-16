import { useMemo } from 'react'
import * as THREE from 'three'
import { effectiveExtent } from '@/engine/grid/GridStore'
import { outwardNormal } from '@/engine/plane/planeGeometry'
import { useAppStore } from '@/store/useAppStore'
import { AXIS_UNIT_VECTOR, UP, toVector3 } from './axisVectors'

const PLANE_CENTER_ADJUST = 0.5

/**
 * Visualizes the active construction plane as a plane-aligned grid and a static arrow indicator
 * showing its axis and orientation.
 */
export function ConstructionPlaneVisual() {
  const plane = useAppStore((s) => s.plane)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)

  const axisVec = AXIS_UNIT_VECTOR[plane.axis]
  const position = useMemo(
    () => axisVec.clone().multiplyScalar(plane.offset + PLANE_CENTER_ADJUST),
    [axisVec, plane.offset],
  )
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, axisVec), [axisVec])
  const arrowDir = useMemo(
    () => toVector3(outwardNormal(plane.axis, plane.orientation)),
    [plane.axis, plane.orientation],
  )
  const arrowQuaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, arrowDir), [arrowDir])

  // Draw the even effective grid (odd rounds up), centered on the world origin so its lines stay on
  // integer cell boundaries. The coarse subdivision count must be an integer for any size.
  const E = effectiveExtent(gridExtent)
  const coarseDivisions = Math.max(1, Math.round(E / 8))

  return (
    <group>
      <group position={position} quaternion={quaternion}>
        <mesh rotation-x={-Math.PI / 2} raycast={() => null}>
          <planeGeometry args={[E, E]} />
          <meshBasicMaterial color="#4ad9ff" transparent opacity={0.035} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <gridHelper args={[E, E, '#3a5a70', '#22303a']} />
        <gridHelper args={[E, coarseDivisions, '#7ac8ff', '#3d6d8a']} />
      </group>

      <group position={position} quaternion={arrowQuaternion}>
        <mesh position={[0, 2.6, 0]} raycast={() => null}>
          <coneGeometry args={[0.28, 0.7, 14]} />
          <meshStandardMaterial color="#f2c94c" emissive="#f2c94c" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 1.4, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.07, 0.07, 2, 10]} />
          <meshStandardMaterial color="#f2c94c" emissive="#f2c94c" emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  )
}
