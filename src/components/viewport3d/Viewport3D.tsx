import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { decodeKey } from '@/engine/grid/GridStore'
import type { InstancingManager } from '@/engine/instancing/InstancingManager'
import { planeFromFaceHit } from '@/engine/plane/constructionPlane'
import { useAppStore } from '@/store/useAppStore'
import { ConstructionPlaneGizmo } from './ConstructionPlaneGizmo'
import { ConstructionPlaneVisual } from './ConstructionPlaneVisual'
import { SceneLighting } from './SceneLighting'
import { VoxelFaceHighlight } from './VoxelFaceHighlight'
import { VoxelInstancedMeshes } from './VoxelInstancedMeshes'

const CLICK_DRAG_THRESHOLD_PX = 4

/**
 * Owns hover tracking — both the whole-voxel hover blink (InstancingManager, via the shared
 * `hoverCell` store field) and the live per-face hover preview (`hoveredFace`, drives
 * VoxelFaceHighlight — updates as the pointer crosses between faces of the same voxel, not just
 * between voxels) — and the click-to-set-construction-plane interaction: a click commits the
 * plane to whichever face is current at click time (spec: first click on a voxel lands the plane
 * on that voxel's own slice — "object mode"; a second click on the SAME voxel advances the plane
 * one step forward through that same face — see `handleVoxelFaceClick` in planeSlice.ts).
 */
function VoxelInteractionHandler({ managerRef }: { managerRef: React.RefObject<InstancingManager | null> }) {
  const { gl, camera } = useThree()
  const handleVoxelFaceClick = useAppStore((s) => s.handleVoxelFaceClick)
  const setHoverCell = useAppStore((s) => s.setHoverCell)
  const setHoveredFace = useAppStore((s) => s.setHoveredFace)

  useEffect(() => {
    const dom = gl.domElement
    const raycaster = new THREE.Raycaster()
    let down: { x: number; y: number } | null = null
    let lastCellKey: string | null = null
    let lastFaceKey: string | null = null

    /** Raycasts to a voxel face and resolves it into a would-be construction plane, in one shot —
     * shared by hover (preview) and click (commit) so they always agree on what's under the cursor. */
    function resolveFaceHit(clientX: number, clientY: number) {
      const manager = managerRef.current
      if (!manager) return null
      const rect = dom.getBoundingClientRect()
      const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObjects(manager.meshList, false)[0]
      if (!hit || hit.instanceId === undefined || !hit.face) return null
      const key = manager.cellKeyForHit(hit.object, hit.instanceId)
      if (!key) return null
      const [x, y, z] = key.split(',').map(Number)
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round()
      const plane = planeFromFaceHit([x, y, z], [worldNormal.x, worldNormal.y, worldNormal.z])
      return { key, plane }
    }

    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
    }

    const onPointerMove = (e: PointerEvent) => {
      const result = resolveFaceHit(e.clientX, e.clientY)

      const cellKey = result?.key ?? null
      if (cellKey !== lastCellKey) {
        lastCellKey = cellKey
        setHoverCell(cellKey ? decodeKey(cellKey) : null, null)
      }

      const faceKey = result ? `${result.key}|${result.plane.axis}|${result.plane.orientation}` : null
      if (faceKey !== lastFaceKey) {
        lastFaceKey = faceKey
        setHoveredFace(result ? { cellKey: result.key, axis: result.plane.axis, orientation: result.plane.orientation } : null)
      }
    }

    const onPointerLeave = () => {
      lastCellKey = null
      lastFaceKey = null
      setHoverCell(null, null)
      setHoveredFace(null)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > CLICK_DRAG_THRESHOLD_PX) return // treat as an orbit drag, not a click

      const result = resolveFaceHit(e.clientX, e.clientY)
      if (!result) return
      handleVoxelFaceClick(result.key, result.plane.axis, result.plane.orientation, result.plane.offset)
    }

    dom.addEventListener('pointerdown', onPointerDown)
    dom.addEventListener('pointerup', onPointerUp)
    dom.addEventListener('pointermove', onPointerMove)
    dom.addEventListener('pointerleave', onPointerLeave)
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [gl, camera, managerRef, handleVoxelFaceClick, setHoverCell, setHoveredFace])

  return null
}

export function Viewport3D() {
  const managerRef = useRef<InstancingManager | null>(null)
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null)

  return (
    <div className="h-full min-w-0 bg-neutral-900">
      {/* flat disables R3F's default ACESFilmicToneMapping — that curve compresses/rolls off
          brightness at moderate light intensities, which was fighting every lighting change.
          With it off, on-screen brightness maps linearly and predictably to light intensity. */}
      <Canvas flat camera={{ position: [18, 16, 20], fov: 45 }} gl={{ antialias: true }}>
        <color attach="background" args={['#111114']} />
        <SceneLighting />
        <ConstructionPlaneVisual orbitControlsRef={orbitControlsRef} />
        <VoxelInstancedMeshes ref={managerRef} />
        <VoxelFaceHighlight />
        <ConstructionPlaneGizmo />
        <VoxelInteractionHandler managerRef={managerRef} />
        <OrbitControls ref={orbitControlsRef} makeDefault enableDamping dampingFactor={0.12} minDistance={2} maxDistance={150} />
      </Canvas>
    </div>
  )
}
