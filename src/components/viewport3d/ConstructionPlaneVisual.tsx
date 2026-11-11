import { useMemo } from 'react'
import * as THREE from 'three'
import { viewOriginShift } from '@/engine/grid/GridStore'
import { axisIndex, outwardNormal } from '@/engine/plane/planeGeometry'
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
  // Half-cell in-plane nudge for odd sizes so the grid centres on the center pillar (matching the
  // gizmo at [shift,shift,shift] and the 2D view). Zero along the plane's own axis — depth is
  // already at cell-centre via PLANE_CENTER_ADJUST.
  const shift = viewOriginShift(gridExtent)
  const position = useMemo(() => {
    const p = axisVec.clone().multiplyScalar(plane.offset + PLANE_CENTER_ADJUST)
    const inPlaneShift = new THREE.Vector3(shift, shift, shift)
    inPlaneShift.setComponent(axisIndex(plane.axis), 0)
    return p.add(inPlaneShift)
  }, [axisVec, plane.offset, plane.axis, shift])
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, axisVec), [axisVec])
  const arrowDir = useMemo(
    () => toVector3(outwardNormal(plane.axis, plane.orientation)),
    [plane.axis, plane.orientation],
  )
  const arrowQuaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, arrowDir), [arrowDir])

  // Draw the project's own extent (odd or even). The `position` above shifts the group half a cell
  // in-plane for odd sizes, so a size-`n` gridHelper (whose lines sit at half-integers about its
  // centre) lands its lines back on integer cell boundaries and frames cells centred on the pillar.
  // The half-step slab reuses the whole-slice grid position (the cut plane sits at the same
  // depth); the grid tints gold instead so the dwell mode reads at a glance.
  const n = gridExtent
  const coarseDivisions = Math.max(1, Math.round(n / 8))
  const halfStep = plane.half !== null

  return (
    <group>
      <group position={position} quaternion={quaternion}>
        <mesh rotation-x={-Math.PI / 2} raycast={() => null}>
          <planeGeometry args={[n, n]} />
          <meshBasicMaterial color="#4ad9ff" transparent opacity={0.035} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <gridHelper args={[n, n, halfStep ? '#f2c94c' : '#3a5a70', halfStep ? '#5a4d22' : '#22303a']} />
        <gridHelper args={[n, coarseDivisions, halfStep ? '#f2c94c' : '#7ac8ff', halfStep ? '#8a6d2f' : '#3d6d8a']} />
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
