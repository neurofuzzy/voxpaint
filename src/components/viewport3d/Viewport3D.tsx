import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { decodeKey, effectiveExtent, viewOriginShift } from '@/engine/grid/GridStore'
import { hasActiveAnimations } from '@/engine/animation/animationLayers'
import type { InstancingManager } from '@/engine/instancing/InstancingManager'
import { planeFromFaceHit } from '@/engine/plane/constructionPlane'
import { useAppStore } from '@/store/useAppStore'
import { usePlaneLayerScroll } from '@/components/usePlaneLayerScroll'
import { AnimatedModelView } from './AnimatedModelView'
import { BoundingBoxFaceSelector } from './BoundingBoxFaceSelector'
import { CompassIcon, CompassTracker } from './Compass'
import { ConstructionPlaneGizmo } from './ConstructionPlaneGizmo'
import { ConstructionPlaneVisual } from './ConstructionPlaneVisual'
import { ExposureSlider } from './ExposureSlider'
import { OptimizedMeshView } from './OptimizedMeshView'
import { PivotGizmo } from './PivotGizmo'
import { SceneEnvironment } from './SceneEnvironment'
import { SceneLighting } from './SceneLighting'
import { TexturedModelView } from './TexturedModelView'
import { ViewOptionsOverlay } from './ViewOptionsOverlay'
import { VoxelFaceHighlight } from './VoxelFaceHighlight'
import { SettingsPalette } from './SettingsPalette'
import { VoxelGhostPreview } from './VoxelGhostPreview'
import { VoxelInstancedMeshes } from './VoxelInstancedMeshes'

const CLICK_DRAG_THRESHOLD_PX = 4

/** Camera framing tuned for a 16³ project — matches the 2D editor's reference extent
 * (canvasConstants.ts `REFERENCE_GRID_EXTENT`) so both views frame a given size consistently. */
const BASE_CAMERA_POS: [number, number, number] = [18, 16, 20]
const CAMERA_REFERENCE_EXTENT = 16

/** Default camera position for a project of the given extent: the base framing scaled by the (even)
 * effective-extent ratio (so the camera pulls back for large models and pushes in for small ones),
 * then offset by the view origin shift so an odd project frames its center column dead-centre. */
function cameraPosForExtent(gridExtent: number): [number, number, number] {
  const s = effectiveExtent(gridExtent) / CAMERA_REFERENCE_EXTENT
  const shift = viewOriginShift(gridExtent)
  return [BASE_CAMERA_POS[0] * s + shift, BASE_CAMERA_POS[1] * s + shift, BASE_CAMERA_POS[2] * s + shift]
}

/**
 * Keeps the camera framed to the project's size. On extent change (a new/loaded project of a
 * different locked-in size) it repositions the camera to the size-appropriate default, recenters
 * the orbit target, and re-captures that as the OrbitControls "home" state so the Reset-camera
 * button returns here. Extent is locked per project, so this never fires mid-edit.
 */
function CameraRig({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  useEffect(() => {
    const [x, y, z] = cameraPosForExtent(gridExtent)
    camera.position.set(x, y, z)
    // Aim at the working origin — shifted half a cell for odd sizes so the center column is centred.
    const t = viewOriginShift(gridExtent)
    const controls = controlsRef.current
    if (controls) {
      controls.target.set(t, t, t)
      controls.update()
      controls.saveState() // so controls.reset() (the Reset-camera button) returns to this framing
    } else {
      camera.lookAt(t, t, t)
    }
  }, [gridExtent, camera, controlsRef])
  return null
}

/**
 * Khronos "PBR Neutral" tone mapping (`NeutralToneMapping`) — the same curve the glTF Sample
 * Viewer defaults to — so this preview's highlight rolloff/contrast matches how the exported
 * model actually looks in a reference PBR viewer instead of the flat, unrolled-off output of
 * `NoToneMapping`. Applied imperatively (not via `Canvas`'s `gl` prop) so `exposure` stays
 * reactive to the store without needing to recreate the renderer.
 */
function ToneMappingController({ exposure }: { exposure: number }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping
  }, [gl])
  useEffect(() => {
    gl.toneMappingExposure = exposure
  }, [gl, exposure])
  return null
}

/**
 * Owns hover tracking — both the whole-voxel hover blink (InstancingManager, via the shared
 * `hoverCell` store field) and the live per-face hover preview (`hoveredFace`, drives
 * VoxelFaceHighlight — updates as the pointer crosses between faces of the same voxel, not just
 * between voxels) — and the click-to-set-construction-plane interaction: a click commits the
 * plane to whichever face is current at click time (spec: first click on a voxel lands the plane
 * on that voxel's own slice — "object mode"; a second click on the SAME voxel advances the plane
 * one step forward through that same face — see `handleVoxelFaceClick` in planeSlice.ts).
 */
const ORBIT_HINT = 'Orbit: left-drag to rotate · right-drag: pan · scroll: zoom'

function voxelHint(axis: string, orientation: number): string {
  const dir: Record<string, Record<number, string>> = {
    x: { 1: 'east', '-1': 'west' },
    y: { 1: 'up', '-1': 'down' },
    z: { 1: 'south', '-1': 'north' },
  }
  return `Click to set the construction plane to this voxel facing ${dir[axis]?.[orientation] ?? ''}`
}
const AGAIN_HINT = 'Click again to move the construction plane forward'

function VoxelInteractionHandler({ managerRef }: { managerRef: React.RefObject<InstancingManager | null> }) {
  const { gl, camera } = useThree()
  const handleVoxelFaceClick = useAppStore((s) => s.handleVoxelFaceClick)
  const objectModeTarget = useAppStore((s) => s.objectModeTarget)
  const objectModeTargetRef = useRef(objectModeTarget)
  objectModeTargetRef.current = objectModeTarget
  const setHoverCell = useAppStore((s) => s.setHoverCell)
  const setHoveredFace = useAppStore((s) => s.setHoveredFace)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

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
      // Raycast full-cell AABBs (the invisible pick mesh), not the visible chamfer geometry, so a
      // click on a sloped chamfer face still resolves to that cell and a clean ±axis face normal.
      const hit = raycaster.intersectObject(manager.pickObject, false)[0]
      if (!hit || hit.instanceId === undefined || !hit.face) return null
      const key = manager.cellKeyForPick(hit.instanceId)
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

      const target = objectModeTargetRef.current
      const again = result && target
        && result.key === target.cellKey
        && result.plane.axis === target.axis
        && result.plane.orientation === target.orientation
      setStatusMessage(result ? (again ? AGAIN_HINT : voxelHint(result.plane.axis, result.plane.orientation)) : ORBIT_HINT)
    }

    const onPointerLeave = () => {
      lastCellKey = null
      lastFaceKey = null
      setHoverCell(null, null)
      setHoveredFace(null)
      setStatusMessage(null)
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
  }, [gl, camera, managerRef, handleVoxelFaceClick, setHoverCell, setHoveredFace, setStatusMessage])

  return null
}

export function Viewport3D() {
  const managerRef = useRef<InstancingManager | null>(null)
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null)
  const mode = useAppStore((s) => s.mode)
  const animSettings = useAppStore((s) => s.animSettings)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const exposure = useAppStore((s) => s.exposure)
  // Initial framing for the current project's extent. The <Canvas> reads this once at mount;
  // CameraRig keeps it in sync on any later extent change. (Select the number, not a fresh array,
  // so this doesn't re-render on unrelated store updates.)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const containerRef = useRef<HTMLDivElement>(null)
  usePlaneLayerScroll(containerRef)
  const [showExposure, setShowExposure] = useState(false)
  const compassNeedleRef = useRef<HTMLDivElement>(null)

  const textureMode = mode === 'texture'
  const animateMode = mode === 'animate'
  const hasAnimations = animateMode && hasActiveAnimations(animSettings)

  return (
    <div
      ref={containerRef}
      data-tour="viewport3d"
      className="relative h-full min-w-0 bg-neutral-900"
      onPointerEnter={() => setStatusMessage(ORBIT_HINT)}
      onPointerLeave={() => setStatusMessage(null)}
    >
      <Canvas camera={{ position: cameraPosForExtent(gridExtent), fov: 45 }} gl={{ antialias: true }}>
        <ToneMappingController exposure={exposure} />
        <CameraRig controlsRef={orbitControlsRef} />
        <color attach="background" args={['#111114']} />
        <SceneLighting />
        <SceneEnvironment />
        {textureMode ? (
          <>
            <TexturedModelView />
            <BoundingBoxFaceSelector />
          </>
        ) : (
          <>
            <ConstructionPlaneVisual />
            {!hasAnimations && <VoxelInstancedMeshes ref={managerRef} />}
            {!hasAnimations && <OptimizedMeshView />}
            {hasAnimations && <AnimatedModelView />}
            <VoxelFaceHighlight />
            <VoxelGhostPreview />
            <ConstructionPlaneGizmo />
            <PivotGizmo />
            <VoxelInteractionHandler managerRef={managerRef} />
          </>
        )}
          <OrbitControls ref={orbitControlsRef} makeDefault enableDamping dampingFactor={0.12} minDistance={2} maxDistance={150} />
          <CompassTracker iconRef={compassNeedleRef} />
      </Canvas>
      <ViewOptionsOverlay
        onResetCamera={() => orbitControlsRef.current?.reset()}
        showExposure={showExposure}
        onToggleExposure={() => setShowExposure((v) => !v)}
      />
      <SettingsPalette />
      {showExposure && <ExposureSlider />}
      <CompassIcon iconRef={compassNeedleRef} />
    </div>
  )
}
