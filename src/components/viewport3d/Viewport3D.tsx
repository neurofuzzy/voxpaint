import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { decodeKey, effectiveExtent, viewOriginShift } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import { hasActiveAnimations } from '@/engine/animation/animationLayers'
import type { InstancingManager } from '@/engine/instancing/InstancingManager'
import { planeFromFaceHit } from '@/engine/plane/constructionPlane'
import { axisIndex, outwardNormal } from '@/engine/plane/planeGeometry'
import { useAppStore } from '@/store/useAppStore'
import { usePlaneLayerScroll } from '@/components/usePlaneLayerScroll'
import { AnimatedModelView } from './AnimatedModelView'
import { BoundingBoxFaceSelector } from './BoundingBoxFaceSelector'
import { CompassIcon, CompassTracker } from './Compass'
import { ViewportModeToggle } from './ViewportModeToggle'
import { ConstructionPlaneGizmo } from './ConstructionPlaneGizmo'
import { ConstructionPlaneVisual } from './ConstructionPlaneVisual'
import { FloatGhostPreview } from './FloatGhostPreview'
import { ExposureSlider } from './ExposureSlider'
import { MarkersView } from './MarkersView'
import { OptimizedMeshView } from './OptimizedMeshView'
import { PivotGizmo } from './PivotGizmo'
import { ProjectBoundsBox } from './ProjectBoundsBox'
import { SelectionHighlight } from './SelectionHighlight'
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

/** Default camera position for a project of the given extent and Y voxel scale: the base
 * framing scaled by the (even) effective-extent ratio (so the camera pulls back for large models
 * and pushes in for small ones), stretched vertically by the voxel scale, then offset so an odd
 * project frames its center column dead-centre. */
function cameraPosForExtent(gridExtent: number, voxelScaleY: number): [number, number, number] {
  const s = effectiveExtent(gridExtent) / CAMERA_REFERENCE_EXTENT
  const shift = viewOriginShift(gridExtent)
  return [BASE_CAMERA_POS[0] * s + shift, (BASE_CAMERA_POS[1] * s + shift) * voxelScaleY, BASE_CAMERA_POS[2] * s + shift]
}

/**
 * Keeps the camera framed to the project's size. On extent/scale change (a new/loaded project of
 * a different locked-in size, or a voxel-height change) it repositions the camera to the
 * size-appropriate default, recenters the orbit target, and re-captures that as the OrbitControls
 * "home" state so the Reset-camera button returns here. Extent is locked per project, so this
 * never fires mid-edit.
 */
function CameraRig({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const voxelScaleY = useAppStore((s) => s.meta.voxelScaleY)
  useEffect(() => {
    const [x, y, z] = cameraPosForExtent(gridExtent, voxelScaleY)
    camera.position.set(x, y, z)
    // Aim at the working origin — shifted half a cell for odd sizes so the center column is centred
    // (and stretched by the voxel scale along Y, matching the scaled scene group below).
    const t = viewOriginShift(gridExtent)
    const controls = controlsRef.current
    if (controls) {
      controls.target.set(t, t * voxelScaleY, t)
      controls.update()
      controls.saveState() // so controls.reset() (the Reset-camera button) returns to this framing
    } else {
      camera.lookAt(t, t * voxelScaleY, t)
    }
  }, [gridExtent, voxelScaleY, camera, controlsRef])
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
 *
 * In 3D Edit mode (`edit3D`) with a paint/erase/eyedropper/material tool active, taps dispatch
 * the tool straight onto voxel faces — paint adds the neighbor cell across the face, erase deletes
 * the cell, eyedropper samples its slot, material recolors the cell. Paint/erase/eyedropper are
 * tap-only (drags orbit, so sweeps can't spray voxels); material recolors in place and is safe to
 * drag, bracketed as one undo stroke with orbit suppressed until pointer-up. Empty-space paint
 * taps start a blob on the active slice. Every other tool keeps the plane-setting behavior in
 * both modes.
 */
const ORBIT_HINT = 'Orbit: left-drag to rotate · right-drag: pan · scroll: zoom'
const EDIT_ORBIT_HINT = 'Edit 3D: click a face to apply the tool · drag empty space to orbit · right-drag: orbit'

/** Tools that apply straight onto voxel faces in 3D Edit mode (everything else keeps the
 * click-to-set-plane behavior there). Paint/erase/eyedropper are tap-only — drags orbit, so a
 * sweep can never spray voxels along the raycast. Material only recolors existing voxels (never
 * adds), so it is safe to drag. */
const BLOCKING_TOOLS = ['paint', 'erase', 'eyedropper', 'material'] as const
type BlockingTool = (typeof BLOCKING_TOOLS)[number]

function editHint(tool: BlockingTool): string {
  if (tool === 'paint') return 'Click a face to paint a voxel'
  if (tool === 'erase') return 'Click a voxel to erase it'
  if (tool === 'material') return 'Click or drag to repaint · never adds voxels'
  return 'Click a voxel to pick its color'
}

function voxelHint(axis: string, orientation: number): string {
  const dir: Record<string, Record<number, string>> = {
    x: { 1: 'east', '-1': 'west' },
    y: { 1: 'up', '-1': 'down' },
    z: { 1: 'south', '-1': 'north' },
  }
  return `Click to set the construction plane to this voxel facing ${dir[axis]?.[orientation] ?? ''}`
}
const AGAIN_HINT = 'Click again to move the construction plane forward'

function VoxelInteractionHandler({ managerRef, controlsRef }: {
  managerRef: React.RefObject<InstancingManager | null>
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}) {
  const { gl, camera } = useThree()
  const handleVoxelFaceClick = useAppStore((s) => s.handleVoxelFaceClick)
  const objectModeTarget = useAppStore((s) => s.objectModeTarget)
  const objectModeTargetRef = useRef(objectModeTarget)
  objectModeTargetRef.current = objectModeTarget
  const plane = useAppStore((s) => s.plane)
  const planeRef = useRef(plane)
  planeRef.current = plane
  const edit3D = useAppStore((s) => s.edit3D)
  const edit3DRef = useRef(edit3D)
  edit3DRef.current = edit3D
  const activeTool = useAppStore((s) => s.activeTool)
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const setHoverCell = useAppStore((s) => s.setHoverCell)
  const setHoveredFace = useAppStore((s) => s.setHoveredFace)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  useEffect(() => {
    const dom = gl.domElement
    const raycaster = new THREE.Raycaster()
    let down: { x: number; y: number } | null = null
    let lastCellKey: string | null = null
    let lastFaceKey: string | null = null
    // Open material drag stroke (Edit mode only): recoloring is idempotent — it never adds or
    // deletes cells — so sweeping across faces is safe, unlike paint/erase drags. One undo stroke
    // per drag, orbit suppressed until pointer-up; `lastKey` dedupes repeat hits on one cell.
    let materialDrag: { lastKey: string | null } | null = null

    /** True when the pointer should dispatch the active tool onto voxel faces instead of setting
     * the construction plane (Edit mode + a blocking tool). */
    function isBlocking(): boolean {
      return edit3DRef.current && (BLOCKING_TOOLS as readonly string[]).includes(activeToolRef.current)
    }

    function ndcFor(clientX: number, clientY: number): THREE.Vector2 {
      const rect = dom.getBoundingClientRect()
      return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    }

    /** Raycasts to a voxel face and resolves it into a would-be construction plane, in one shot —
     * shared by hover (preview) and click (commit) so they always agree on what's under the cursor. */
    function resolveFaceHit(clientX: number, clientY: number) {
      const manager = managerRef.current
      if (!manager) return null
      raycaster.setFromCamera(ndcFor(clientX, clientY), camera)
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

    /** Cell on the active construction plane under the cursor when no voxel was hit (painting
     * into empty space starts a blob on the current slice). Null when the ray runs parallel. */
    function resolveEmptyCell(clientX: number, clientY: number): Coord | null {
      const activePlane = planeRef.current
      raycaster.setFromCamera(ndcFor(clientX, clientY), camera)
      const ai = axisIndex(activePlane.axis)
      const normal = new THREE.Vector3()
      normal.setComponent(ai, 1)
      const coplanar = new THREE.Vector3()
      coplanar.setComponent(ai, activePlane.offset + 0.5)
      const point = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, coplanar), new THREE.Vector3())
      if (!point) return null
      const coord: Coord = [Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)]
      coord[ai] = activePlane.offset
      return coord
    }

    /** Applies the blocking tool once for a tap (Edit mode only): paint adds the neighbor cell
     * across the face, erase deletes the cell, eyedropper samples its slot, material recolors the
     * cell. Paint/erase/material bracket their own single-cell undo stroke; eyedropper mutates no
     * model. Paint/erase/eyedropper drags never apply (every pointer crossing would spray voxels
     * along the raycast), so movement always orbits — material alone drags (see onPointerMove). */
    function applyBlockingTap(clientX: number, clientY: number) {
      const store = useAppStore.getState()
      const tool = activeToolRef.current
      const result = resolveFaceHit(clientX, clientY)
      if (result) {
        if (tool === 'eyedropper') {
          const cell = store.model.color.get(result.key)
          if (!cell) return
          store.setActivePaletteSlot(cell.paletteSlot)
          store.setActiveTool('paint') // after picking, drop straight into painting with the picked color
          return
        }
        if (tool === 'material') {
          const [x, y, z] = result.key.split(',').map(Number)
          store.bakeFloatIfAny()
          store.beginStroke()
          store.paintMaterialAtCoord([x, y, z])
          store.commitStroke()
          return
        }
        const [x, y, z] = result.key.split(',').map(Number)
        const normal = outwardNormal(result.plane.axis, result.plane.orientation)
        const target: Coord =
          tool === 'paint' ? [x + normal[0], y + normal[1], z + normal[2]] : [x, y, z]
        store.bakeFloatIfAny()
        store.beginStroke()
        if (tool === 'paint') store.paintCellAtCoord(target, result.plane.axis, result.plane.orientation)
        else store.eraseCellAtCoord(target)
        store.commitStroke()
        return
      }
      // Empty space: paint starts a blob on the active slice; erase/eyedrop need a voxel.
      if (tool !== 'paint') return
      const coord = resolveEmptyCell(clientX, clientY)
      if (!coord) return
      const activePlane = planeRef.current
      store.bakeFloatIfAny()
      store.beginStroke()
      store.paintCellAtCoord(coord, activePlane.axis, activePlane.orientation)
      store.commitStroke()
    }

    /** Ends an open material drag stroke and hands orbit control back. */
    function endMaterialDrag() {
      if (!materialDrag) return
      materialDrag = null
      useAppStore.getState().commitStroke()
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
      if (!isBlocking() || e.button !== 0 || !e.isPrimary) return
      // Material alone drags: open the stroke now (a tap = down+up with no move in between).
      if (activeToolRef.current !== 'material') return
      const result = resolveFaceHit(e.clientX, e.clientY)
      if (!result) return
      const store = useAppStore.getState()
      store.bakeFloatIfAny()
      store.beginStroke()
      materialDrag = { lastKey: result.key }
      if (controlsRef.current) controlsRef.current.enabled = false
      const [x, y, z] = result.key.split(',').map(Number)
      store.paintMaterialAtCoord([x, y, z])
      try {
        dom.setPointerCapture(e.pointerId)
      } catch {
        // Pointer already released/implicit capture (touch) — the up handler still commits.
      }
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

      // Material drag recolors each newly crossed voxel (deduped per cell — recoloring is
      // idempotent, so this can never pile anything up). Every other blocking tool is tap-only.
      if (materialDrag && e.buttons !== 0) {
        const result = resolveFaceHit(e.clientX, e.clientY)
        if (result && result.key !== materialDrag.lastKey) {
          materialDrag.lastKey = result.key
          const [x, y, z] = result.key.split(',').map(Number)
          useAppStore.getState().paintMaterialAtCoord([x, y, z])
        }
      }

      // Hover state only, except the material drag above — paint/erase/eyedropper movement never
      // applies, so those drags always orbit.
      if (activeToolRef.current === 'marker') {
        setStatusMessage(result ? 'Click to select this marker · click empty space to place a new one' : 'Click to place a marker')
        return
      }
      if (isBlocking()) {
        const tool = activeToolRef.current as BlockingTool
        setStatusMessage(result ? editHint(tool) : EDIT_ORBIT_HINT)
        return
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
      endMaterialDrag()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (materialDrag) {
        endMaterialDrag()
        down = null
        return
      }
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > CLICK_DRAG_THRESHOLD_PX) return // treat as an orbit drag, not a click
      // In Edit mode the blocking tools never set the plane — taps apply the tool instead.
      // Only the left button taps (right/middle are orbit/dolly now).
      if (isBlocking()) {
        if (e.button !== 0) return
        applyBlockingTap(e.clientX, e.clientY)
        return
      }

      // Marker tool never sets the plane — taps select the marker on the hit cell, or drop a
      // new one there (on the active slice when empty space was hit). One undo stroke per tap.
      if (activeToolRef.current === 'marker') {
        if (e.button !== 0) return
        const store = useAppStore.getState()
        const result = resolveFaceHit(e.clientX, e.clientY)
        const coord: Coord | null = result
          ? result.key.split(',').map(Number) as Coord
          : resolveEmptyCell(e.clientX, e.clientY)
        if (!coord) return
        const existing = store.markers.find(
          (m) => m.position[0] === coord[0] && m.position[1] === coord[1] && m.position[2] === coord[2],
        )
        if (existing) {
          store.selectMarker(existing.id)
          return
        }
        store.beginStroke()
        store.addMarker(coord)
        store.commitStroke()
        return
      }

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
  }, [gl, camera, managerRef, controlsRef, handleVoxelFaceClick, setHoverCell, setHoveredFace, setStatusMessage])

  return null
}

export function Viewport3D() {
  const managerRef = useRef<InstancingManager | null>(null)
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null)
  const mode = useAppStore((s) => s.mode)
  const animSettings = useAppStore((s) => s.animSettings)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const exposure = useAppStore((s) => s.exposure)
  // Initial framing for the current project's extent/scale. The <Canvas> reads this once at mount;
  // CameraRig keeps it in sync on any later change. (Select scalars, not fresh arrays/objects,
  // so this doesn't re-render on unrelated store updates.)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const voxelScaleY = useAppStore((s) => s.meta.voxelScaleY)
  const edit3D = useAppStore((s) => s.edit3D)
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
      <Canvas camera={{ position: cameraPosForExtent(gridExtent, voxelScaleY), fov: 45 }} gl={{ antialias: true }}>
        <ToneMappingController exposure={exposure} />
        <CameraRig controlsRef={orbitControlsRef} />
        <color attach="background" args={['#111114']} />
        <SceneLighting />
        <SceneEnvironment />
        {/* All working-volume contents live under the Y-scale group so voxels render flat/tall
          while every consumer keeps speaking unit-cube grid coordinates (picking resolves through
          the scaled parent back to grid-space cell keys). */}
        {textureMode ? (
          <group scale={[1, voxelScaleY, 1]}>
            <TexturedModelView />
            <BoundingBoxFaceSelector />
          </group>
        ) : (
          <>
            <group scale={[1, voxelScaleY, 1]}>
              <ConstructionPlaneVisual />
              <ProjectBoundsBox />
              {!hasAnimations && <VoxelInstancedMeshes ref={managerRef} />}
              {!hasAnimations && <OptimizedMeshView />}
              {hasAnimations && <AnimatedModelView />}
              <VoxelFaceHighlight />
              <VoxelGhostPreview />
              <FloatGhostPreview />
              <SelectionHighlight />
              <ConstructionPlaneGizmo />
              <PivotGizmo />
              <MarkersView />
            </group>
            <VoxelInteractionHandler managerRef={managerRef} controlsRef={orbitControlsRef} />
          </>
        )}
          <OrbitControls
            ref={orbitControlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.12}
            minDistance={2}
            maxDistance={150}
            mouseButtons={{
              LEFT: THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.DOLLY,
              // In 3D Edit mode the left button is busy tapping tools, so right-drag takes over
              // orbiting (panning stays on touch gestures).
              RIGHT: edit3D ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
            }}
          />
          <CompassTracker iconRef={compassNeedleRef} />
      </Canvas>
      <ViewOptionsOverlay
        onResetCamera={() => orbitControlsRef.current?.reset()}
        showExposure={showExposure}
        onToggleExposure={() => setShowExposure((v) => !v)}
      />
      <SettingsPalette />
      {showExposure && <ExposureSlider />}
      <div className="absolute left-5 top-5 z-40 flex items-center gap-2">
        <CompassIcon iconRef={compassNeedleRef} />
        <ViewportModeToggle />
      </div>
    </div>
  )
}
