import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { InstancingManager } from '@/engine/instancing/InstancingManager'
import { planeFromFaceHit } from '@/engine/plane/constructionPlane'
import { useAppStore } from '@/store/useAppStore'
import { ConstructionPlaneGizmo } from './ConstructionPlaneGizmo'
import { ConstructionPlaneVisual } from './ConstructionPlaneVisual'
import { SceneLighting } from './SceneLighting'
import { VoxelInstancedMeshes } from './VoxelInstancedMeshes'

const CLICK_DRAG_THRESHOLD_PX = 4

function FaceClickHandler({ managerRef }: { managerRef: React.RefObject<InstancingManager | null> }) {
  const { gl, camera } = useThree()
  const setPlaneAxisOrientation = useAppStore((s) => s.setPlaneAxisOrientation)
  const setPlaneOffset = useAppStore((s) => s.setPlaneOffset)

  useEffect(() => {
    const dom = gl.domElement
    const raycaster = new THREE.Raycaster()
    let down: { x: number; y: number } | null = null

    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > CLICK_DRAG_THRESHOLD_PX) return // treat as an orbit drag, not a click
      const manager = managerRef.current
      if (!manager) return

      const rect = dom.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(manager.meshList, false)
      const hit = hits[0]
      if (!hit || hit.instanceId === undefined || !hit.face) return

      const key = manager.cellKeyForHit(hit.object, hit.instanceId)
      if (!key) return
      const [x, y, z] = key.split(',').map(Number)
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round()
      const plane = planeFromFaceHit([x, y, z], [worldNormal.x, worldNormal.y, worldNormal.z])
      setPlaneAxisOrientation(plane.axis, plane.orientation)
      setPlaneOffset(plane.offset)
    }

    dom.addEventListener('pointerdown', onPointerDown)
    dom.addEventListener('pointerup', onPointerUp)
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointerup', onPointerUp)
    }
  }, [gl, camera, managerRef, setPlaneAxisOrientation, setPlaneOffset])

  return null
}

export function Viewport3D() {
  const managerRef = useRef<InstancingManager | null>(null)
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null)

  return (
    <div className="h-full min-w-0 bg-neutral-900">
      <Canvas camera={{ position: [18, 16, 20], fov: 45 }} gl={{ antialias: true }}>
        <color attach="background" args={['#111114']} />
        <SceneLighting />
        <ConstructionPlaneVisual orbitControlsRef={orbitControlsRef} />
        <VoxelInstancedMeshes ref={managerRef} />
        <ConstructionPlaneGizmo />
        <FaceClickHandler managerRef={managerRef} />
        <OrbitControls ref={orbitControlsRef} makeDefault enableDamping dampingFactor={0.12} />
      </Canvas>
    </div>
  )
}
