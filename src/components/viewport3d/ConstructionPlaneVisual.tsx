import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { DEFAULT_GRID_EXTENT } from '@/engine/grid/GridStore'
import { outwardNormal } from '@/engine/plane/planeGeometry'
import { useAppStore } from '@/store/useAppStore'
import { AXIS_UNIT_VECTOR, UP, toVector3 } from './axisVectors'

// The plane sheet renders through the *centers* of its layer's voxels (offset + 0.5), not flush
// against a face — cells span [offset, offset+1) along the axis, so their centers sit at +0.5. Same
// value for either orientation (0.5 back from the flush face along the outward normal).
const PLANE_CENTER_ADJUST = 0.5

/**
 * Visualizes the active construction plane as a plane-aligned grid (replacing a static
 * always-on-the-ground gridHelper, which never actually showed *which* slice was active), plus a
 * draggable arrow gizmo on it — dragging moves the plane back and forth along its own axis,
 * snapped to whole grid units, so there's a direct 3D way to change offset besides the 2D
 * editor's +/- stepper.
 */
export function ConstructionPlaneVisual({ orbitControlsRef }: { orbitControlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const plane = useAppStore((s) => s.plane)
  const setPlaneOffset = useAppStore((s) => s.setPlaneOffset)
  const { gl, camera } = useThree()
  const draggingRef = useRef(false)

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

  /** Returns the sheet's *visual* world position along the axis (not the stored `plane.offset` —
   * see `position` above for the orientation adjustment between the two). */
  function sheetPositionFromPointer(clientX: number, clientY: number): number {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, camera)
    const O = raycaster.ray.origin
    const D = raycaster.ray.direction
    const L = axisVec
    // Closest point between the axis line (through the origin) and the pointer ray — standard
    // closest-point-between-two-skew-lines projection; L and D are both unit vectors.
    const a = 1
    const b = L.dot(D)
    const c = 1
    const d = L.dot(O)
    const e = D.dot(O)
    const denom = a * c - b * b
    if (Math.abs(denom) < 1e-6) return plane.offset + PLANE_CENTER_ADJUST // camera looking straight down the axis — degenerate
    return (b * e - c * d) / denom
  }

  useEffect(() => {
    const dom = gl.domElement
    function onMove(ev: PointerEvent) {
      if (!draggingRef.current) return
      setPlaneOffset(Math.round(sheetPositionFromPointer(ev.clientX, ev.clientY) - PLANE_CENTER_ADJUST))
    }
    function onUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = true
    }
    dom.addEventListener('pointermove', onMove)
    dom.addEventListener('pointerup', onUp)
    return () => {
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, plane.axis, plane.offset, plane.orientation, orbitControlsRef, setPlaneOffset])

  return (
    <group>
      <group position={position} quaternion={quaternion}>
        {/* Faint fill so the plane reads as a surface, not just lines. */}
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[DEFAULT_GRID_EXTENT, DEFAULT_GRID_EXTENT]} />
          <meshBasicMaterial color="#4ad9ff" transparent opacity={0.035} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {/* Fine per-cell + bolder every-8-cell tiers, mirroring the 2D canvas's grid hierarchy.
            GridHelper's "center line" pair conveniently lands exactly on the plane's own (0,0)
            origin (spec: origin on the other two axes is always 0,0), so it doubles as the
            brighter "origin" tier without a third geometry. */}
        <gridHelper args={[DEFAULT_GRID_EXTENT, DEFAULT_GRID_EXTENT, '#3a5a70', '#22303a']} />
        <gridHelper args={[DEFAULT_GRID_EXTENT, DEFAULT_GRID_EXTENT / 8, '#7ac8ff', '#3d6d8a']} />
      </group>

      <group position={position} quaternion={arrowQuaternion}>
        <mesh
          position={[0, 2.6, 0]}
          onPointerDown={(e) => {
            e.stopPropagation()
            draggingRef.current = true
            if (orbitControlsRef.current) orbitControlsRef.current.enabled = false
          }}
        >
          <coneGeometry args={[0.28, 0.7, 14]} />
          <meshStandardMaterial color="#f2c94c" emissive="#f2c94c" emissiveIntensity={0.35} />
        </mesh>
        <mesh
          position={[0, 1.4, 0]}
          onPointerDown={(e) => {
            e.stopPropagation()
            draggingRef.current = true
            if (orbitControlsRef.current) orbitControlsRef.current.enabled = false
          }}
        >
          <cylinderGeometry args={[0.07, 0.07, 2, 10]} />
          <meshStandardMaterial color="#f2c94c" emissive="#f2c94c" emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  )
}
