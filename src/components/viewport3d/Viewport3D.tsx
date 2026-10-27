import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { decodeKey, encodeKey, effectiveExtent, viewOriginShift, withinWorkingBounds } from '@/engine/grid/GridStore'
import { rigBoxContains, rigIdForCoord, rigPivotOf } from '@/engine/rigging/types'
import { angleAroundAxis, composeAxisAngle, gizmoRadiusForBox, intersectAxisPlane, nearestRingHit, parentChainMatrix, projectToTrackball, trackballEuler } from '@/engine/rigging/pose'
import { hasActiveRigLoops, isLoopActive } from '@/engine/rigging/rigLoop'
import type { Axis, CellKey, Coord } from '@/engine/grid/types'
import { hasActiveAnimations } from '@/engine/animation/animationLayers'
import type { InstancingManager } from '@/engine/instancing/InstancingManager'
import { placedFloatCoords } from '@/engine/instancing/ghostBatches'
import type { ClipboardData, FloatOrigin } from '@/store/types'
import { gridCoordFromPixel, pixelFromGridCoord, planeFromFaceHit } from '@/engine/plane/constructionPlane'
import { bresenhamLine } from '@/engine/tools/lineUtils'
import { WAND_DOUBLE_TAP_MS } from '@/engine/tools/wandTool'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { resolveDirectPaintTarget } from '@/store/ghostPlacement'
import { voxelKindForCell } from '@/engine/tools/eyedropperTool'
import { windowSliceCells } from '@/engine/tools/cellSetOps'
import { useAppStore } from '@/store/useAppStore'
import { usePlaneLayerScroll } from '@/components/usePlaneLayerScroll'
import { AnimatedModelView } from './AnimatedModelView'
import { PoseGizmo } from './PoseGizmo'
import { RigPoseView } from './RigPoseView'
import { BoundingBoxFaceSelector } from './BoundingBoxFaceSelector'
import { CompassIcon, CompassTracker } from './Compass'
import { BrushPreview } from './BrushPreview'
import { brushViewQuaternion } from './brushViewSync'
import { ConstructionPlaneGizmo } from './ConstructionPlaneGizmo'
import { ConstructionPlaneVisual } from './ConstructionPlaneVisual'
import { FloatGhostPreview } from './FloatGhostPreview'
import { ExposureSlider } from './ExposureSlider'
import { MarkersView } from './MarkersView'
import { OptimizedMeshView } from './OptimizedMeshView'
import { PivotGizmo } from './PivotGizmo'
import { RigLinkLines } from './RigLinkLines'
import { ProjectBoundsBox } from './ProjectBoundsBox'
import { SelectionHighlight } from './SelectionHighlight'
import { SceneEnvironment } from './SceneEnvironment'
import { SceneLighting } from './SceneLighting'
import { SelectionBox3D } from './SelectionBox3D'
import { TexturedModelView } from './TexturedModelView'
import { TextureFaceHighlight } from './TextureFaceHighlight'
import { ViewOptionsOverlay } from './ViewOptionsOverlay'
import { VoxelFaceHighlight } from './VoxelFaceHighlight'
import { SettingsPalette } from './SettingsPalette'
import { VoxelGhostPreview } from './VoxelGhostPreview'
import { VoxelInstancedMeshes } from './VoxelInstancedMeshes'
import { RigBoxHighlight } from './RigBoxHighlight'
import { RiggingPalette } from './RiggingPalette'

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
 * one step forward through that same face — see `handleVoxelFaceClick` in planeSlice.ts; in
 * Animate mode the second click instead selects the rig box the voxel belongs to).
 *
 * When the cursor hits no voxel face, hover falls back to the construction-plane cell under the
 * cursor (`resolveEmptyCell`), so the ghost preview still marks what a click would paint.
 *
 * In 3D-only layout with a paint/erase/eyedropper/material/select/wand tool active,
 * taps dispatch the tool straight onto voxel faces — paint adds a voxel (unlocked: the neighbor
 * cell across the face, Zanpo-style; locked via the plane-lock toggle: the active slice under
 * the cursor, replacing whatever sits there — off-slice voxels are never even highlighted),
 * erase deletes the cell, eyedropper samples its color and voxel type, material recolors
 * the cell, wand selects connected color (whole touching component on rapid re-tap). Select
 * taps work like the 2D tool: a tap replaces the selection with the tapped voxel (reorienting
 * first, like a plain model click), a rapid second tap flood-selects the plane slice instead,
 * and shift variants union rather than replace (shift-taps never move the plane); taps on
 * already-selected voxels keep everything; drags marquee or move. Explicit wheel/UI plane
 * changes clear the selection instead of fighting it. Paint/erase/eyedropper are
 * tap-only (drags orbit, so sweeps can't spray voxels); material recolors in place and is safe to
 * drag, bracketed as one undo stroke with orbit suppressed until pointer-up; select and wand
 * capture left-drag on a selected voxel to lift and move it in the plane's UV axes (Alt: full
 * depth) — wand defers the lift past the tap threshold so taps keep working, otherwise select
 * opens a plane-slice marquee — right-drag still orbits. With the move tool, left-drag
 * translates the entire model along the construction plane (like the 2D tool — slice moves
 * stay there), live as one undo step; a tap orients the plane like a plain model click.
 * Presses whose ray misses the working cube open no gesture at all — drags orbit, taps no-op
 * (select-mode taps clear the selection instead). Press location decides, not the drag path.
 * Empty-space paint taps start a blob on the active slice. In split layout the viewport is
 * orbit/navigate only and every tap sets the construction plane.
 */
const ORBIT_HINT = 'Orbit: left-drag to rotate · right-drag: pan · scroll: zoom'
const EDIT_HINT = 'Edit 3D: click a face to apply the tool · drag empty space to orbit · right-drag: orbit'

/** Tools that apply straight onto voxel faces in 3D-only layout (everything else keeps the
 * click-to-set-plane behavior there). Paint/erase/eyedropper are tap-only — drags orbit, so a
 * sweep can never spray voxels along the raycast. Material only recolors existing voxels
 * (never adds), so it is safe to drag. Select and wand capture left-drag on a selected voxel
 * to lift and move it in the plane's UV axes (Alt: full depth) — wand defers the lift until
 * past the tap threshold so taps keep their two-stage click behavior; otherwise select opens a
 * plane-slice marquee on drag (a tap only reorients the plane, never selecting). Right-drag
 * still orbits, per the 3D-only convention. */
const BLOCKING_TOOLS = ['paint', 'erase', 'eyedropper', 'material', 'select', 'wand', 'rigbox'] as const
type BlockingTool = (typeof BLOCKING_TOOLS)[number]

function editHint(tool: BlockingTool): string {
  if (tool === 'paint') {
    return 'Locked to the plane: click to replace · Shift-click draws a line · R rotates the brush'
  }
  if (tool === 'erase') return 'Click a voxel to erase it'
  if (tool === 'material') return 'Click or drag to repaint · never adds voxels'
  if (tool === 'select') return 'Drag to marquee-select · click selects the voxel and sets the plane · double-click selects the slice region · Shift adds to the selection'
  if (tool === 'wand') return 'Click a component for its color · re-tap it quickly for the whole component · drag inside to move'
  if (tool === 'rigbox') return 'Click a voxel to box its color-connected region as a named rig mesh'
  return 'Click a voxel to pick its color and type'
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

/**
 * Whether a plane-space (u,v) lands inside a pending float's footprint rect — the 3D answer
 * to the 2D tool's `isCellSelected(selection, u, v)` check. Used to grab a paste float: its
 * ghost is display-only for picking (`useGhostGroup` disables raycast), so the press ray
 * falls through to whatever model voxel — or empty plane cell — sits behind it.
 */
function uvInFloatRect(floatContent: ClipboardData, floatOrigin: FloatOrigin, u: number, v: number): boolean {
  return (
    u >= floatOrigin.originU &&
    u < floatOrigin.originU + floatContent.width &&
    v >= floatOrigin.originV &&
    v < floatOrigin.originV + floatContent.height
  )
}

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
  const layoutMode = useAppStore((s) => s.layoutMode)
  const layoutModeRef = useRef(layoutMode)
  layoutModeRef.current = layoutMode
  const mode = useAppStore((s) => s.mode)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const activeTool = useAppStore((s) => s.activeTool)
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const touchPaintHold = useAppStore((s) => s.touchPaintHold)
  const touchPaintHoldRef = useRef(touchPaintHold)
  touchPaintHoldRef.current = touchPaintHold
  const setHoverCell = useAppStore((s) => s.setHoverCell)
  const setHoveredFace = useAppStore((s) => s.setHoveredFace)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  useEffect(() => {
    const dom = gl.domElement
    const raycaster = new THREE.Raycaster()
    let down: { x: number; y: number } | null = null
    // True when the press ray misses the working cube entirely: nothing actionable lives out
    // there, so the press opens no gesture — drags orbit, taps no-op, except select-mode taps,
    // which clear the selection (2D margin-tap parity). Recomputed per press (press location
    // decides, not the drag path).
    let downOutside = false
    let lastCellKey: string | null = null
    let lastFaceKey: string | null = null
    // Open material drag stroke (3D-only layout only): recoloring is idempotent — it never adds or
    // deletes cells — so sweeping across faces is safe, unlike paint/erase drags. One undo stroke
    // per drag, orbit suppressed until pointer-up; `lastKey` dedupes repeat hits on one cell.
    let materialDrag: { lastKey: string | null } | null = null
    // Open select marquee (3D-only layout only): drag start cell on the active plane. Committed on
    // pointer-up — a plane-slice SelectionRegion in split, the full slice window (occupied or
    // empty) as an exact set in 3D-only; cancelled on pointer-leave. A tap (no drag) replaces
    // the selection with the tapped voxel (reorienting first); taps on already-selected voxels
    // keep everything. Window selection
    // is strictly planar (volumetric selection belongs to the wand). Orbit suppressed until
    // pointer-up, like the material drag. The pending selection is mirrored to the store
    // preview every move so the 3D selection box tracks the drag live (`selectPreview` window
    // in split, `selectedCellsPreview` exact keys in 3D-only); `selectPreviewEnd` dedupes
    // repeat resolves on one cell.
    let selectDrag: { start: Coord } | null = null
    let selectPreviewEnd: Coord | null = null
    // Open select float-drag (3D-only layout only): pointer went down on a selected voxel. The
    // lift waits until the pointer actually moves past the tap threshold (mirroring the
    // wand's pendingWandDrag), so taps resolve as plain clicks on release instead of
    // churning a lift-and-bake roundtrip; crossing the threshold lifts and converts to a
    // float drag that follows the pointer in the plane's UV axes. Release drops it (baked),
    // exactly like the drop below — orbit suppressed throughout.
    let floatDrag: { startU: number; startV: number; originU: number; originV: number; cells3D: Set<CellKey> } | null = null
        // Armed select grab (3D-only layout only): pointer went down on a selected voxel with no live
        // float, lift still pending. A tap releases as a no-op through the normal tap path (the
        // selection owns the plane — only double-clicks act from there); movement past the
        // threshold converts to `floatDrag` above.
        let pendingSelectGrab: { startU: number; startV: number; alt: boolean } | null = null
    // Pending wand grab (3D-only layout only): pointer went down on a selected voxel with the wand.
    // Unlike select it must NOT lift yet — a tap here is a two-stage wand click, so the lift
    // waits until the pointer actually moves past the tap threshold, then converts to floatDrag.
    let pendingWandDrag: { startU: number; startV: number } | null = null
    // Open whole-model move drag (3D-only layout, Model mode only): the plane-UV anchor plus the
    // last-applied UV (integer-deduped, like the 2D tool) and whether the undo stroke opened. The
    // stroke opens on the first over-threshold move; a tap orients the plane instead. Orbit
    // suppressed until pointer-up, like the marquee.
    let moveDrag: { startU: number; startV: number; lastU: number; lastV: number; begun: boolean } | null = null
    // Open touch hold-to-paint drag (3D-only Model + paint tool + hold button pressed): the
    // stylus/finger paints directly onto the construction plane while orbit stays locked.
    // One undo stroke per drag, bracketed here (not per cell); `lastCoord` anchors the
    // Bresenham interpolation so fast sweeps don't gap. Orbit suppressed until pointer-up.
    let paintTouchDrag: { lastCoord: Coord } | null = null
    // Open pose drag (Animate mode, Pose tool only): pointer went down on a gizmo ring
    // (axis drag, immediate — a ring is never a plane-nav target) or armed a trackball
    // drag on the selected box's body (converts past the tap threshold, so plain taps keep
    // their normal plane-navigation/select behavior). Orbit suppressed until pointer-up, and
    // the tap path below is skipped on release.
    let poseDrag:
      | { kind: 'axis'; boxId: string; axis: Axis; grabAngle: number; startEuler: [number, number, number] }
      | { kind: 'track'; boxId: string; startEuler: [number, number, number]; startVec: [number, number, number]; parentQuat: THREE.Quaternion; radius: number; center: Coord }
      | null = null
    // Armed pose-trackball press (threshold not crossed yet): a tap resolves via the normal
    // tap path on release; crossing the threshold converts to `poseDrag` above.
    let pendingPoseDrag: { boxId: string; startX: number; startY: number } | null = null
    // Last select-tool tap (3D-only layout only) for double-click detection: a rapid second tap
    // on the same voxel flood-selects the plane slice instead of re-landing the plane (see the
    // tap commit below). Stale entries self-expire via the timing check; drags and canvas-leave
    // clear it outright.
    let lastSelectTap: { time: number; key: string } | null = null

    /** True when the pointer should dispatch the active tool onto voxel faces instead of
     * setting the construction plane (3D-only layout + a blocking tool). Split layout is
     * orbit/navigate only. */
    function isBlocking(): boolean {
      return layoutModeRef.current === '3d-only' && (BLOCKING_TOOLS as readonly string[]).includes(activeToolRef.current)
    }

    /** True while the touch hold-to-paint button is down in 3D-only Model with the paint
     * tool: the stylus/finger paints directly onto the construction plane and orbit stays
     * locked. Paint only — every other tool keeps its tap/drag behavior. */
    function isTouchPainting(): boolean {
      return touchPaintHoldRef.current
        && layoutModeRef.current === '3d-only'
        && modeRef.current === 'model'
        && activeToolRef.current === 'paint'
    }

    /** Resolves what a touch hold-to-paint pointer paints: the shared direct-paint target
     * (face hit → plane-projected replace; else the plane cell under the cursor), so drag
     * writes agree with taps and the ghost preview. Null when the ray runs parallel to the
     * plane or the target is out of bounds. */
    function resolveTouchPaintTarget(clientX: number, clientY: number): Coord | null {
      const st = useAppStore.getState()
      const activePlane = planeRef.current
      const hit = resolveFaceHit(clientX, clientY)
      if (hit) {
        const [x, y, z] = hit.key.split(',').map(Number)
        const cell: Coord = [x, y, z]
        return resolveDirectPaintTarget(
          activePlane,
          cell,
          { cellKey: hit.key, axis: hit.plane.axis, orientation: hit.plane.orientation },
          st.meta.gridExtent,
        )
      }
      const empty = resolveEmptyCell(clientX, clientY)
      if (!empty) return null
      return resolveDirectPaintTarget(activePlane, empty, null, st.meta.gridExtent)
    }

    /** Writes one touch hold-to-paint cell inside the already-open stroke (orientation
     * always inherits the active construction plane, matching taps and the ghost).
     * Replace-only: occupied cells are overwritten, like taps. */
    function paintTouchCell(coord: Coord): void {
      const st = useAppStore.getState()
      if (!withinWorkingBounds(coord, st.meta.gridExtent)) return
      st.paintCellAtCoord(coord, st.plane.axis, st.plane.orientation)
    }

    /** Paints the interpolated run from the drag's last cell to the current target so fast
     * stylus sweeps don't gap (plane-UV Bresenham, like the 2D drag path). Both endpoints
     * sit on the active slice by construction, so the run stays in-plane. */
    function paintTouchRunTo(target: Coord, drag: { lastCoord: Coord }): void {
      const activePlane = planeRef.current
      const a = pixelFromGridCoord(activePlane, drag.lastCoord)
      const b = pixelFromGridCoord(activePlane, target)
      if (a.u === b.u && a.v === b.v) return
      for (const [lu, lv] of bresenhamLine(a.u, a.v, b.u, b.v)) {
        const c = gridCoordFromPixel(activePlane, lu, lv)
        paintTouchCell(c)
      }
      drag.lastCoord = target
    }

    /** Ends an open touch hold-to-paint drag: one undo step for the whole sweep, orbit back. */
    function endPaintTouchDrag(commit: boolean) {
      if (!paintTouchDrag) return
      const last = paintTouchDrag.lastCoord
      paintTouchDrag = null
      const st = useAppStore.getState()
      st.setPaintLineAnchor({ coord: last, axis: st.plane.axis, orientation: st.plane.orientation })
      if (commit) st.commitStroke()
      else st.cancelStroke()
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    function ndcFor(clientX: number, clientY: number): THREE.Vector2 {
      const rect = dom.getBoundingClientRect()
      return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    }

    /** Whether the press ray misses the working cube (`[-half, half)` cells, Y-stretched like
     * the scene group). A missing ray can hit no voxel and paints nothing — it orbits. */
    function pressOutsideCube(clientX: number, clientY: number): boolean {
      const st = useAppStore.getState()
      const half = effectiveExtent(st.meta.gridExtent) / 2
      const sy = st.meta.voxelScaleY
      raycaster.setFromCamera(ndcFor(clientX, clientY), camera)
      return !raycaster.ray.intersectsBox(new THREE.Box3(
        new THREE.Vector3(-half, -half * sy, -half),
        new THREE.Vector3(half, half * sy, half),
      ))
    }

    /** Raycasts to a voxel face and resolves it into a would-be construction plane, in one shot —
     * shared by hover (preview) and click (commit) so they always agree on what's under the cursor. */
    function resolveFaceHit(clientX: number, clientY: number) {
      const manager = managerRef.current
      if (!manager) return null
      raycaster.setFromCamera(ndcFor(clientX, clientY), camera)
      // Raycast full-cell AABBs (the invisible pick mesh), not the visible chamfer geometry, so a
      // click on a sloped chamfer face still resolves to that cell and a clean ±axis face normal.
      const hits = raycaster.intersectObject(manager.pickObject, false)
      // Isolate mode clips the model to the selected box — skip hits on hidden voxels so taps
      // and hovers land on visible geometry (or fall through to the empty-plane cell).
      const st = useAppStore.getState()
      const isolateBox =
        st.mode === 'animate' && st.isolateRig
          ? st.rigBoxes.find((b) => b.id === st.selectedRigBoxId) ?? null
          : null
      for (const hit of hits) {
        if (hit.instanceId === undefined || !hit.face) continue
        const key = manager.cellKeyForPick(hit.instanceId)
        if (!key) continue
        if (isolateBox && !rigBoxContains(isolateBox, decodeKey(key))) continue
        const [x, y, z] = key.split(',').map(Number)
        const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round()
        const plane = planeFromFaceHit([x, y, z], [worldNormal.x, worldNormal.y, worldNormal.z])
        return { key, plane }
      }
      return null
    }

    /** Grid-space ray for the pose gizmo: the world ray with Y unscaled (the scene group
     * stretches world Y by `voxelScaleY`, while pose math speaks unit-cube grid coords). */
    function gridSpaceRay(clientX: number, clientY: number): { origin: [number, number, number]; dir: [number, number, number] } | null {
      const sy = useAppStore.getState().meta.voxelScaleY
      raycaster.setFromCamera(ndcFor(clientX, clientY), camera)
      const o = raycaster.ray.origin
      const d = raycaster.ray.direction
      const dir = new THREE.Vector3(d.x, d.y / sy, d.z).normalize()
      if (!Number.isFinite(dir.x + dir.y + dir.z)) return null
      return { origin: [o.x, o.y / sy, o.z], dir: [dir.x, dir.y, dir.z] }
    }

    /** Cell on the active construction plane under the cursor when no voxel was hit (painting
     * into empty space starts a blob on the current slice). Null when the ray runs parallel.
     * Y-scale aware: the scene group stretches world Y by `voxelScaleY` on every plane (mirroring
     * `pressOutsideCube`), so the y-plane's slice meets the ray at (offset + 0.5) * sy while
     * x/z-plane slices sit at their unscaled offset — but the intersection's world Y is stretched
     * in all three cases, so grid Y is always point.y / sy. */
    function resolveEmptyCell(clientX: number, clientY: number): Coord | null {
      const activePlane = planeRef.current
      raycaster.setFromCamera(ndcFor(clientX, clientY), camera)
      const ai = axisIndex(activePlane.axis)
      const sy = useAppStore.getState().meta.voxelScaleY
      const normal = new THREE.Vector3()
      normal.setComponent(ai, 1)
      const coplanar = new THREE.Vector3()
      coplanar.setComponent(ai, activePlane.axis === 'y' ? (activePlane.offset + 0.5) * sy : activePlane.offset + 0.5)
      const point = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, coplanar), new THREE.Vector3())
      if (!point) return null
      const coord: Coord = [Math.floor(point.x), Math.floor(point.y / sy), Math.floor(point.z)]
      coord[ai] = activePlane.offset
      return coord
    }

    /** Applies the blocking tool once for a tap (3D-only layout only): paint replaces the
     * construction-plane cell under the cursor (the clicked voxel when it is on-slice,
     * otherwise the plane-projected cell behind it) — erase
     * deletes the cell, eyedropper samples its color and voxel type,
     * material recolors the cell, select reorients the plane without touching the selection,
     * wand selects connected color (whole component on rapid re-tap; empty space clears the
     * selection). Paint/erase bracket their own undo stroke (paint's gesture action covers both
     * single taps and shift-lines); eyedropper,
     * select and wand mutate no model. Paint/erase/eyedropper/wand drags never apply (every
     * pointer crossing would spray voxels along the raycast), so movement always
     * orbits — material alone drags (see onPointerMove); select commits via its own drag.
     *
     * Paint placement is replace-only on the construction plane, but orientation ALWAYS inherits
     * the active construction plane — never the raycast face — so the write matches the brush
     * preview. The target itself resolves through the shared `resolveDirectPaintTarget`
     * helper, so tap and ghost preview always agree. */
    function applyBlockingTap(clientX: number, clientY: number, shiftKey: boolean, wasSelectGrab = false) {
      const store = useAppStore.getState()
      const tool = activeToolRef.current
      const result = resolveFaceHit(clientX, clientY)
      // Wand: two-stage tap (color-connected, then whole component on rapid re-tap); the wand
      // stays active so the second tap lands here too. Empty space clears. Tap-only.
      if (tool === 'wand') {
        const coord = result ? decodeKey(result.key) : resolveEmptyCell(clientX, clientY)
        if (!coord) return
        store.applyWandAt(coord)
        return
      }
      // Rig wand (animate): single tap boxes the color-connected region. Empty taps
      // toast a hint via the store. Tap-only; stays active for consecutive boxes.
      if (tool === 'rigbox') {
        const coord = result ? decodeKey(result.key) : resolveEmptyCell(clientX, clientY)
        if (!coord) return
        store.applyRigBoxAt(coord)
        return
      }
      // Select taps (3D-only layout only — the split viewport never reaches here with the
      // select tool): a press that armed a grab started inside the selection, so a tap keeps
      // everything (2D parity — the selection owns the plane); a press that hit nothing
      // committable (parallel ray at press time) behaves like a plain Path-A tap instead.
      // Double-clicks flood-select either way.
      if (tool === 'select') {
        if (result) {
          const now = Date.now()
          if (lastSelectTap && now - lastSelectTap.time <= WAND_DOUBLE_TAP_MS && lastSelectTap.key === result.key) {
            lastSelectTap = null
            store.applySliceWandAt(decodeKey(result.key), shiftKey)
            useAppStore.setState((s) => { s.objectModeTarget = null })
          } else {
            lastSelectTap = { time: now, key: result.key }
            if (!wasSelectGrab) {
              store.handleVoxelFaceClick(result.key, result.plane.axis, result.plane.orientation, result.plane.offset)
              store.setSelectedCells(new Set([result.key]))
            }
          }
        }
        return
      }
      if (result) {
        if (tool === 'eyedropper') {
          const cell = store.model.color.get(result.key)
          if (!cell) return
          store.setActivePaletteSlot(cell.paletteSlot)
          store.setActiveVoxelKind(voxelKindForCell(store.model.chamfer.get(result.key)))
          store.setActiveTool('paint') // after picking, drop straight into painting with the picked color and type
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
        const cell: Coord = [x, y, z]
        // Paint resolves through the shared helper (replace-only on the construction plane —
        // on-slice face hits replace the hovered voxel, off-slice hits project onto the
        // plane) so the write matches the ghost preview. A null target (out of bounds)
        // paints nothing.
        // Plain taps paint one cell; shift-taps extend the dominant-axis line from the anchor —
        // every tap re-establishes the anchor, so lines chain. The gesture action brackets its
        // own undo stroke either way.
        if (tool === 'paint') {
          const activePlane = planeRef.current
          const t = resolveDirectPaintTarget(
            activePlane,
            cell,
            { cellKey: result.key, axis: result.plane.axis, orientation: result.plane.orientation },
            store.meta.gridExtent,
          )
          if (!t) return
          store.paintLineAtCoord(t, shiftKey)
          return
        }
        const target: Coord = cell
        store.bakeFloatIfAny()
        store.beginStroke()
        if (tool === 'erase') store.eraseCellAtCoord(target)
        // Any other tool (e.g. select, whose gestures commit via selectDrag) never reaches here,
        // but must never erase — fail closed.
        store.commitStroke()
        return
      }
      // Empty space: paint starts a blob on the active slice; erase/eyedrop need a voxel.
      if (tool !== 'paint') return
      const coord = resolveEmptyCell(clientX, clientY)
      if (!coord) return
      // Empty-space paint taps join the line gesture too (shift extends from the anchor).
      store.paintLineAtCoord(coord, shiftKey)
    }

    /** Ends an open material drag stroke and hands orbit control back. */
    function endMaterialDrag() {
      if (!materialDrag) return
      materialDrag = null
      useAppStore.getState().commitStroke()
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    /** Cancels an open select marquee without committing (pointer left the canvas). */
    function endSelectDrag() {
      if (!selectDrag) return
      selectDrag = null
      selectPreviewEnd = null
      const st = useAppStore.getState()
      st.setSelectPreview(null)
      st.setSelectedCellsPreview(null)
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
      downOutside = pressOutsideCube(e.clientX, e.clientY)
      // Pose tool (Animate mode only): a press near a ring of the selected box opens an
      // axis-rotation drag immediately (a ring is never a plane-nav target); a press on the
      // box body arms a trackball drag that converts past the tap threshold, so plain taps
      // keep their normal rig-select behavior. Rings are hit-tested in screen space (what
      // you see is what's grabbable), so this runs ahead of the working-cube check below —
      // rings routinely overhang empty space outside the cube. Anything else falls through.
      if (e.button === 0 && e.isPrimary && modeRef.current === 'animate' && activeToolRef.current === 'pose') {
        const st = useAppStore.getState()
        const box = st.rigBoxes.find((b) => b.id === st.selectedRigBoxId) ?? null
        // Looped joints are driven by their cycle — gizmo/trackball drags would no-op, so
        // the press falls through to normal tap handling with a hint instead.
        if (box && isLoopActive(box.loop)) {
          setStatusMessage('That box has a looping motion — clear it in the inspector to pose')
        }
        if (box && !isLoopActive(box.loop)) {
          const rect = dom.getBoundingClientRect()
          const sy = st.meta.voxelScaleY
          const pv = new THREE.Vector3()
          const project = (p: Coord): [number, number] | null => {
            pv.set(p[0], p[1] * sy, p[2]).project(camera)
            if (pv.z > 1 || pv.z < -1) return null
            return [rect.left + ((pv.x + 1) / 2) * rect.width, rect.top + ((1 - pv.y) / 2) * rect.height]
          }
          const ray = gridSpaceRay(e.clientX, e.clientY)
          const axis = ray
            ? nearestRingHit(st.rigBoxes, st.poseRotations, box, ray.origin, ray.dir, project, e.clientX, e.clientY, e.pointerType === 'touch' ? 24 : 14)
            : null
          if (axis) {
            const pivot = rigPivotOf(box)
            const pw: Coord = [pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5]
            const pt = ray ? intersectAxisPlane(ray.origin, ray.dir, pw, axis) : null
            if (pt) {
              const euler = st.poseRotations.get(box.id) ?? [0, 0, 0]
              poseDrag = {
                kind: 'axis',
                boxId: box.id,
                axis,
                grabAngle: angleAroundAxis(pt, pw, axis),
                startEuler: [...euler] as [number, number, number],
              }
              // Posing an invisible model shows nothing — Hidden blanks the voxels that
              // move (tool entry normally prevents this; this covers hiding mid-pose).
              if (st.animateModelView === 'hidden') {
                st.setAnimateModelView('ghost')
                setStatusMessage('Model view switched to Ghost — posing needs the model visible')
              }
              st.setPoseDragging(true)
              if (controlsRef.current) controlsRef.current.enabled = false
              try {
                dom.setPointerCapture(e.pointerId)
              } catch {
                // Pointer already released/implicit capture (touch) — the up handler still ends it.
              }
              lastCellKey = null
              lastFaceKey = null
              setHoverCell(null, null)
              setHoveredFace(null)
              setStatusMessage('Rotating joint — drag to pose, release to drop')
              dom.style.cursor = 'grabbing'
              return
            }
          }
          if (!poseDrag) {
            const hit = resolveFaceHit(e.clientX, e.clientY)
            if (hit && rigIdForCoord(st.rigBoxes, decodeKey(hit.key)) === box.id) {
              pendingPoseDrag = { boxId: box.id, startX: e.clientX, startY: e.clientY }
              if (controlsRef.current) controlsRef.current.enabled = false
              try {
                dom.setPointerCapture(e.pointerId)
              } catch {
                // Pointer already released/implicit capture (touch) — the up handler still ends it.
              }
              lastCellKey = null
              lastFaceKey = null
              setHoverCell(null, null)
              setHoveredFace(null)
              return
            }
          }
        }
      }
      // Touch hold-to-paint: while the hold button is down, the primary pointer paints
      // directly onto the construction plane instead of orbiting (orbit is locked via the
      // controls' `enabled` prop; this opens the stroke). Outside-cube and unresolvable
      // presses open no gesture — they no-op while held.
      if (isTouchPainting() && e.button === 0 && e.isPrimary && !downOutside) {
        const target = resolveTouchPaintTarget(e.clientX, e.clientY)
        if (target) {
          const store = useAppStore.getState()
          store.bakeFloatIfAny()
          store.beginStroke()
          paintTouchCell(target)
          paintTouchDrag = { lastCoord: target }
          if (controlsRef.current) controlsRef.current.enabled = false
          try {
            dom.setPointerCapture(e.pointerId)
          } catch {
            // Pointer already released/implicit capture (touch) — the up handler still ends it.
          }
          lastCellKey = null
          lastFaceKey = null
          setHoverCell(null, null)
          setHoveredFace(null)
          setStatusMessage('Painting on the plane — release to end the stroke')
          return
        }
      }
      // Outside the working cube nothing is actionable: open no gesture (controls stay enabled
      // so the press orbits from the real pointerdown) and ignore the tap below.
      // (The pose tool's own press handling sits above this check — its rings routinely
      // overhang empty space outside the cube.)
      if (downOutside) return
      // Move captures left-drag in 3D-only Model mode (right-drag still orbits): the anchor is
      // the plane-UV cell under the cursor (face hit, else the empty-space plane cell); a
      // parallel ray leaves the gesture to orbit.
      if (
        e.button === 0 && e.isPrimary &&
        layoutModeRef.current === '3d-only' &&
        activeToolRef.current === 'move' &&
        modeRef.current === 'model'
      ) {
        const hit = resolveFaceHit(e.clientX, e.clientY)
        const cell = hit ? decodeKey(hit.key) : resolveEmptyCell(e.clientX, e.clientY)
        if (cell) {
          const { u, v } = pixelFromGridCoord(planeRef.current, cell)
          moveDrag = { startU: u, startV: v, lastU: u, lastV: v, begun: false }
          if (controlsRef.current) controlsRef.current.enabled = false
          try {
            dom.setPointerCapture(e.pointerId)
          } catch {
            // Pointer already released/implicit capture (touch) — the up handler still ends it.
          }
          lastCellKey = null
          lastFaceKey = null
          setHoverCell(null, null)
          setHoveredFace(null)
          setStatusMessage('Dragging the whole model in the plane — release to drop it')
          return
        }
      }
      if (!isBlocking() || e.button !== 0 || !e.isPrimary) return
      // Select captures left-drag (right-drag still orbits). A press on a selected voxel lifts
      // the selection and drags it in the plane's UV axes instead of marqueeing. Otherwise the
      // slice-window marquee opens from the hit voxel (else the plane cell under the cursor);
      // a parallel ray leaves the gesture to orbit.
      if (activeToolRef.current === 'select') {
        const store = useAppStore.getState()
        const activePlane = planeRef.current
        const hit = resolveFaceHit(e.clientX, e.clientY)
        // Grab test: explicit-set membership — or the pending paste float's own footprint rect
        // (its ghost never intercepts the ray — after a cut it hangs in empty model space,
        // hence the plane-cell fallback below). Anything else falls through to the marquee,
        // whose commit bakes a pending float first.
        let grabUV: { u: number; v: number } | null = null
        // Live footprint of a continued paste float, for the drop's selection-follow. Recomputed
        // (never read off selectedCells) so a cleared-while-pending set can't strand the ghost:
        // the plane can't change out from under a float — every plane write bakes first.
        let grabFloatCells: Set<CellKey> | null = null
        const continuePasteFloat = (cell: Coord): boolean => {
          if (!store.floatContent || !store.floatOrigin) return false
          const uv = pixelFromGridCoord(activePlane, cell)
          if (!uvInFloatRect(store.floatContent, store.floatOrigin, uv.u, uv.v)) return false
          grabUV = uv
          grabFloatCells = new Set(
            placedFloatCoords(store.floatContent, store.floatOrigin, activePlane, store.meta.gridExtent).map((c) => encodeKey(...c)),
          )
          return true
        }
        if (hit) {
          if (!store.floatContent && store.selectedCells.has(hit.key)) {
            grabUV = pixelFromGridCoord(activePlane, decodeKey(hit.key))
          } else {
            continuePasteFloat(decodeKey(hit.key))
          }
        } else {
          // A cut-paste ghost hangs in empty model space — the press falls through to the
          // plane — so test the plane cell too, the same frame move-drags already steer by.
          const empty = resolveEmptyCell(e.clientX, e.clientY)
          if (empty) continuePasteFloat(empty)
        }
        if (grabUV) {
          const { u, v } = grabUV
          if (store.floatContent) {
            // Continue the pending float immediately (a tap drops it in place) — only when there
            // is one to continue; otherwise arm below.
            const origin = useAppStore.getState().floatOrigin
            if (origin) {
              floatDrag = {
                startU: u,
                startV: v,
                originU: origin.originU,
                originV: origin.originV,
                cells3D: grabFloatCells ?? new Set(store.selectedCells),
              }
              if (controlsRef.current) controlsRef.current.enabled = false
              try {
                dom.setPointerCapture(e.pointerId)
              } catch {
                // Pointer already released/implicit capture (touch) — the up handler still ends it.
              }
              lastCellKey = null
              lastFaceKey = null
              setHoverCell(null, null)
              setHoveredFace(null)
              setStatusMessage('Dragging selection in the plane — release to drop it')
              return
            }
          } else {
            // No live float: arm a deferred lift — the lift waits until the pointer actually
            // moves past the tap threshold (mirroring the wand's pendingWandDrag), so a tap
            // resolves as a plain click on release. Taps never mutate the model and never
            // touch the selection; only a real drag lifts.
            pendingSelectGrab = { startU: u, startV: v, alt: e.altKey }
            if (controlsRef.current) controlsRef.current.enabled = false
            try {
              dom.setPointerCapture(e.pointerId)
            } catch {
              // Pointer already released/implicit capture (touch) — the up handler still ends it.
            }
            lastCellKey = null
            lastFaceKey = null
            setHoverCell(null, null)
            setHoveredFace(null)
            return
          }
        }
        const start: Coord | null = hit ? decodeKey(hit.key) : resolveEmptyCell(e.clientX, e.clientY)
        if (!start) return
        selectDrag = { start }
        selectPreviewEnd = null
        // Seed the live preview so the box appears the moment the drag starts: the full
        // slice window (occupied or empty), mirroring the commit below — unioned when shift
        // is held, so the preview already shows the expanded box.
        {
          const st = useAppStore.getState()
          const seed = new Set(windowSliceCells(planeRef.current, start, start, st.meta.gridExtent))
          st.setSelectedCellsPreview(e.shiftKey ? new Set([...st.selectedCells, ...seed]) : seed)
        }
        if (controlsRef.current) controlsRef.current.enabled = false
        try {
          dom.setPointerCapture(e.pointerId)
        } catch {
          // Pointer already released/implicit capture (touch) — the up handler still commits.
        }
        // Hide the hover ghost while marqueeing so it can't disagree with the marquee.
        lastCellKey = null
        lastFaceKey = null
        setHoverCell(null, null)
        setHoveredFace(null)
        setStatusMessage('Release to select the plane slice')
        return
      }
      // Wand grab: a press on a selected voxel arms a deferred float-drag — deferred (unlike
      // select) because a tap here is a two-stage wand click and must not lift. The lift waits
      // until the pointer moves past the tap threshold (see onPointerMove); anything else falls
      // through to the normal tap path below, and drags from anywhere else orbit as usual.
      if (activeToolRef.current === 'wand') {
        const store = useAppStore.getState()
        const hit = resolveFaceHit(e.clientX, e.clientY)
        // Grab test mirrors select's: explicit-set membership — plus a pending paste float's
        // own footprint rect (its ghost never intercepts the ray). Either arms the deferred
        // drag; anything else falls through to the tap path.
        let grabbed: { u: number; v: number } | null = null
        if (hit) {
          const uv = pixelFromGridCoord(planeRef.current, decodeKey(hit.key))
          if (!store.floatContent && store.selectedCells.has(hit.key)) grabbed = uv
          else if (store.floatContent && store.floatOrigin && uvInFloatRect(store.floatContent, store.floatOrigin, uv.u, uv.v)) grabbed = uv
        }
        if (grabbed) {
          pendingWandDrag = { startU: grabbed.u, startV: grabbed.v }
            if (controlsRef.current) controlsRef.current.enabled = false
            try {
              dom.setPointerCapture(e.pointerId)
            } catch {
              // Pointer already released/implicit capture (touch) — the up handler still ends it.
            }
            lastCellKey = null
            lastFaceKey = null
            setHoverCell(null, null)
            setHoveredFace(null)
            setStatusMessage('Dragging selection in the plane — release to drop it')
          }
        }
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
      // Open touch hold-to-paint drag: every move paints the interpolated run onto the
      // plane inside the open stroke. Non-primary pointers (a second finger) never hijack
      // the run. If the hold was released mid-drag, end the stroke instead of stranding it.
      if (paintTouchDrag) {
        if (!e.isPrimary) return
        if (!isTouchPainting()) {
          endPaintTouchDrag(true)
          return
        }
        const target = resolveTouchPaintTarget(e.clientX, e.clientY)
        if (target) {
          const drag = paintTouchDrag
          const lastKey = encodeKey(...drag.lastCoord)
          if (encodeKey(...target) !== lastKey) paintTouchRunTo(target, drag)
        }
        return
      }
      // Armed pose drag: sub-threshold movement holds the press (a tap resolves via the
      // normal tap path on release); crossing the threshold opens the trackball drag, and
      // execution flows into the pose-drag branch below so the first over-threshold move
      // already displaces.
      if (pendingPoseDrag) {
        if (!e.isPrimary) return
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_DRAG_THRESHOLD_PX) {
          const st = useAppStore.getState()
          const box = st.rigBoxes.find((b) => b.id === pendingPoseDrag!.boxId)
          pendingPoseDrag = null
          if (box) {
            const ray = gridSpaceRay(e.clientX, e.clientY)
            const pivot = rigPivotOf(box)
            const center: Coord = [pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5]
            const radius = gizmoRadiusForBox(box)
            const start = ray ? projectToTrackball(ray.origin, ray.dir, center, radius) : null
            if (start) {
              const parent = parentChainMatrix(st.rigBoxes, st.poseRotations, box)
              const euler = st.poseRotations.get(box.id) ?? [0, 0, 0]
              poseDrag = {
                kind: 'track',
                boxId: box.id,
                startEuler: [...euler] as [number, number, number],
                startVec: start,
                parentQuat: new THREE.Quaternion().setFromRotationMatrix(parent),
                radius,
                center,
              }
              // Same Hidden guard as the ring path: posing needs visible voxels.
              if (st.animateModelView === 'hidden') {
                st.setAnimateModelView('ghost')
                setStatusMessage('Model view switched to Ghost — posing needs the model visible')
              }
              st.setPoseDragging(true)
              dom.style.cursor = 'grabbing'
              setStatusMessage('Rotating joint — drag to pose, release to drop')
            }
          }
          if (!poseDrag && controlsRef.current) controlsRef.current.enabled = true
        } else {
          return
        }
      }
      // Open pose drag: steer the joint from the drag plane's current angle (axis rings wrap
      // so crossing ±π never jumps). Live through setJointRotation — the pose view re-matrices
      // every frame straight from the store, no React renders involved.
      if (poseDrag) {
        if (!e.isPrimary) return
        const st = useAppStore.getState()
        const box = st.rigBoxes.find((b) => b.id === poseDrag!.boxId)
        if (!box) {
          poseDrag = null
          st.setPoseDragging(false)
          if (controlsRef.current) controlsRef.current.enabled = true
          return
        }
        if (poseDrag.kind === 'axis') {
          const ray = gridSpaceRay(e.clientX, e.clientY)
          const pivot = rigPivotOf(box)
          const pw: Coord = [pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5]
          const pt = ray ? intersectAxisPlane(ray.origin, ray.dir, pw, poseDrag.axis) : null
          if (pt) {
            const TAU = Math.PI * 2
            const raw = angleAroundAxis(pt, pw, poseDrag.axis) - poseDrag.grabAngle
            const delta = ((raw + Math.PI) % TAU + TAU) % TAU - Math.PI
            st.setJointRotation(poseDrag.boxId, composeAxisAngle(poseDrag.startEuler, poseDrag.axis, delta))
            // Absolute joint angles (accumulate across grabs — a new drag starts where the
            // last one left off, never back at zero).
            const cur = useAppStore.getState().poseRotations.get(poseDrag.boxId) ?? poseDrag.startEuler
            const deg = (r: number) => `${Math.round((r * 180) / Math.PI)}°`
            setStatusMessage(`Joint ${deg(cur[0])} ${deg(cur[1])} ${deg(cur[2])} — release to drop`)
          }
        } else {
          const ray = gridSpaceRay(e.clientX, e.clientY)
          const pt = ray ? projectToTrackball(ray.origin, ray.dir, poseDrag.center, poseDrag.radius) : null
          if (pt) {
            st.setJointRotation(poseDrag.boxId, trackballEuler(poseDrag.startEuler, poseDrag.parentQuat, poseDrag.startVec, pt))
            const cur = useAppStore.getState().poseRotations.get(poseDrag.boxId) ?? poseDrag.startEuler
            const deg = (r: number) => `${Math.round((r * 180) / Math.PI)}°`
            setStatusMessage(`Joint ${deg(cur[0])} ${deg(cur[1])} ${deg(cur[2])} — release to drop`)
          }
        }
        return
      }
      // Open whole-model move: steer by the plane cell under the cursor (face hit, else the
      // empty-space plane cell — the model slides under the pointer like the 2D tool). The
      // stroke opens on the first over-threshold move; integer-UV dedupe skips sub-cell moves.
      if (moveDrag) {
        if (
          !moveDrag.begun && down &&
          Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_DRAG_THRESHOLD_PX
        ) {
          moveDrag.begun = true
          useAppStore.getState().beginMove(true)
        }
        if (moveDrag.begun) {
          const hit = resolveFaceHit(e.clientX, e.clientY)
          const cell = hit ? decodeKey(hit.key) : resolveEmptyCell(e.clientX, e.clientY)
          if (cell) {
            const { u, v } = pixelFromGridCoord(planeRef.current, cell)
            if (u !== moveDrag.lastU || v !== moveDrag.lastV) {
              moveDrag.lastU = u
              moveDrag.lastV = v
              useAppStore.getState().updateMove(u - moveDrag.startU, v - moveDrag.startV)
            }
          }
        }
        return
      }
      // Pending wand grab: sub-threshold movement holds the press (a tap resolves via the normal
      // tap path on release); crossing the threshold lifts and converts to a float drag, flowing
      // into the branch below so the first over-threshold move displaces. Lifts the exact voxel
      // set (Alt ignored — the set already spans every depth it covers).
      if (pendingWandDrag) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_DRAG_THRESHOLD_PX) {
          const store = useAppStore.getState()
          // A pending paste float converts straight to a drag (no lift — nothing was taken
          // out of the model); anything else lifts fresh like before.
          const continuingFloat = !!store.floatContent
          if (!store.floatContent) {
            store.liftCellsToFloat(store.selectedCells)
          }
          const origin = useAppStore.getState().floatOrigin
          if (origin) {
            const st = useAppStore.getState()
            floatDrag = {
              startU: pendingWandDrag.startU,
              startV: pendingWandDrag.startV,
              originU: origin.originU,
              originV: origin.originV,
              // Live footprint for a continued paste float (the set was never lifted from and
              // may have cleared since); the lifted keys for a fresh lift, empties included.
              // The drop shifts this by the drag delta, so the selection follows the bake.
              cells3D: continuingFloat && st.floatContent
                ? new Set(placedFloatCoords(st.floatContent, origin, planeRef.current, st.meta.gridExtent).map((c) => encodeKey(...c)))
                : new Set(st.selectedCells),
            }
          }
          pendingWandDrag = null
        } else {
          return
        }
      }
      // Armed select grab: sub-threshold movement holds the press (a tap resolves via the
      // normal tap path on release); crossing the threshold lifts and converts to a float
      // drag, flowing into the branch below so the first over-threshold move displaces.
      // Lifts the exact voxel set (Alt ignored — the set already spans every depth it covers).
      if (pendingSelectGrab) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_DRAG_THRESHOLD_PX) {
          const store = useAppStore.getState()
          if (!store.floatContent) {
            store.liftCellsToFloat(store.selectedCells)
          }
          const origin = useAppStore.getState().floatOrigin
          if (origin) {
            floatDrag = {
              startU: pendingSelectGrab.startU,
              startV: pendingSelectGrab.startV,
              originU: origin.originU,
              originV: origin.originV,
              cells3D: new Set(store.selectedCells),
            }
            setStatusMessage('Dragging selection in the plane — release to drop it')
          }
          pendingSelectGrab = null
        } else {
          return
        }
      }
      // Open float drag: reposition the pending float from the plane cell under the cursor, in
      // the plane's UV axes. The float ghost is the live feedback; hover stays cleared.
      if (floatDrag) {
        const cell = resolveEmptyCell(e.clientX, e.clientY)
        if (cell) {
          const { u, v } = pixelFromGridCoord(planeRef.current, cell)
          const st = useAppStore.getState()
          const nu = floatDrag.originU + (u - floatDrag.startU)
          const nv = floatDrag.originV + (v - floatDrag.startV)
          st.moveFloatCellsTo(nu, nv)
        }
        return
      }
      // Open marquee drag: mirror the pending selection to the store preview so the 3D
      // selection box grows with the drag (committed on pointer-up): the full slice window
      // (occupied or empty). Hover stays cleared until release.
      if (selectDrag) {
        const hit = resolveFaceHit(e.clientX, e.clientY)
        const end = hit ? decodeKey(hit.key) : resolveEmptyCell(e.clientX, e.clientY)
        if (
          end &&
          (!selectPreviewEnd ||
            selectPreviewEnd[0] !== end[0] ||
            selectPreviewEnd[1] !== end[1] ||
            selectPreviewEnd[2] !== end[2])
        ) {
          selectPreviewEnd = end
          const st = useAppStore.getState()
          const cells = windowSliceCells(planeRef.current, selectDrag.start, end, st.meta.gridExtent)
          st.setSelectedCellsPreview(e.shiftKey ? new Set([...st.selectedCells, ...cells]) : new Set(cells))
        }
        return
      }

      // Paint hovers resolve through the shared direct-paint target (see the ghost): the
      // cursor previews the plane cell a click would paint.
      const result = resolveFaceHit(e.clientX, e.clientY)

      // No voxel face under the cursor: fall back to the construction plane, so the ghost
      // preview still marks the cell a click would paint (empty-space paint starts a blob on
      // the active slice — see applyBlockingTap). Null when the ray runs parallel to the plane.
      const empty = result ? null : resolveEmptyCell(e.clientX, e.clientY)
      const hoverCoord = result ? decodeKey(result.key) : empty
      // Isolate mode hides every voxel outside the selected box — don't light up hover chrome
      // for voxels you can't see (taps still navigate the plane: only the highlight is gated).
      const st = useAppStore.getState()
      const isolateBox =
        modeRef.current === 'animate' && st.isolateRig
          ? st.rigBoxes.find((b) => b.id === st.selectedRigBoxId) ?? null
          : null
      const inBox = !isolateBox || !hoverCoord || rigBoxContains(isolateBox, hoverCoord)
      const shownCoord = inBox ? hoverCoord : null
      const cellKey = result?.key ?? (empty ? encodeKey(...empty) : null)
      const shownKey = inBox ? cellKey : null
      // Pose mode runs no voxel hover chrome at all (no face highlight, no hover blink) —
      // the only hover feedback is the ring affordance below. Clear anything stale once,
      // then skip: taps resolve their own hit on pointer-up.
      const poseNoHover = modeRef.current === 'animate' && activeToolRef.current === 'pose'
      if (poseNoHover) {
        if (lastCellKey !== null || lastFaceKey !== null) {
          lastCellKey = null
          lastFaceKey = null
          setHoverCell(null, null)
          setHoveredFace(null)
        }
      } else if (shownKey !== lastCellKey) {
        lastCellKey = shownKey
        setHoverCell(shownCoord, null)
      }

      const faceKey = result && inBox ? `${result.key}|${result.plane.axis}|${result.plane.orientation}` : null
      if (!poseNoHover && faceKey !== lastFaceKey) {
        lastFaceKey = faceKey
        setHoveredFace(result && inBox ? { cellKey: result.key, axis: result.plane.axis, orientation: result.plane.orientation } : null)
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
      // Animate mode never edits in 3D — rig/pivot taps fall through to plane navigation
      // below; orbit otherwise. The 2D canvas owns all rig edits. The pose tool steers the
      // selected joint instead (see the drag wiring above) and its taps only ever switch the
      // rig selection — the plane stays put.
      if (modeRef.current === 'animate' && activeToolRef.current === 'pose') {
        // Live ring affordance: hovering a ring names its axis and grabs the cursor, so it's
        // obvious what's draggable before pressing. Same screen-space test as the down path.
        const st = useAppStore.getState()
        const box = st.rigBoxes.find((b) => b.id === st.selectedRigBoxId) ?? null
        let ringAxis: Axis | null = null
        if (box && !poseDrag && !pendingPoseDrag) {
          const rect = dom.getBoundingClientRect()
          const sy = st.meta.voxelScaleY
          const pv = new THREE.Vector3()
          const ray = gridSpaceRay(e.clientX, e.clientY)
          if (ray) {
            ringAxis = nearestRingHit(st.rigBoxes, st.poseRotations, box, ray.origin, ray.dir,
              (p) => {
                pv.set(p[0], p[1] * sy, p[2]).project(camera)
                if (pv.z > 1 || pv.z < -1) return null
                return [rect.left + ((pv.x + 1) / 2) * rect.width, rect.top + ((1 - pv.y) / 2) * rect.height]
              },
              e.clientX, e.clientY)
          }
        }
        dom.style.cursor = ringAxis ? 'grab' : ''
        if (ringAxis) {
          setStatusMessage(`Drag to rotate about ${ringAxis.toUpperCase()} · drag the body for free rotation`)
        } else {
          setStatusMessage(result ? 'Drag to pose the selected joint · drag a ring for one axis · click selects a rig' : ORBIT_HINT)
        }
        return
      }
      if ((activeToolRef.current === 'rigbox' || activeToolRef.current === 'pivot') && modeRef.current === 'animate') {
        setStatusMessage(result ? voxelHint(result.plane.axis, result.plane.orientation) : ORBIT_HINT)
        return
      }
      if (isBlocking()) {
        const tool = activeToolRef.current as BlockingTool
        // Select and wand both act from empty space too, so their hints show even with no hit.
        setStatusMessage(tool === 'select' || tool === 'wand' ? editHint(tool) : result ? editHint(tool) : EDIT_HINT)
        return
      }
      // Fill owns its taps (never sets the plane), so it needs its own hints — the plane
      // hints below would lie. In split layout the viewport is orbit-only as usual.
      if (activeToolRef.current === 'fill' && layoutModeRef.current === '3d-only') {
        const st = useAppStore.getState()
        if (st.selectedCells.size > 0 || st.selection) {
          setStatusMessage('Click to fill the selection with the brush')
        } else if (result) {
          setStatusMessage('Click to flood-fill material · Alt: whole component')
        } else {
          setStatusMessage('Click empty space to fill the plane slice')
        }
        return
      }
      // Move drags the whole model in the plane (like the 2D tool); taps orient the plane.
      if (activeToolRef.current === 'move' && layoutModeRef.current === '3d-only' && modeRef.current === 'model') {
        setStatusMessage('Drag to move the entire model along the plane · click a voxel to set the plane')
        return
      }

      const target = objectModeTargetRef.current
      const again = result && target
        && result.key === target.cellKey
        && result.plane.axis === target.axis
        && result.plane.orientation === target.orientation
      if (result && again && modeRef.current === 'animate') {
        // The second tap selects the rig in Animate (see handleVoxelFaceClick) — say so when
        // the voxel belongs to one; otherwise the tap still advances the plane.
        const st = useAppStore.getState()
        setStatusMessage(rigIdForCoord(st.rigBoxes, decodeKey(result.key)) ? 'Click again to select this rig box' : AGAIN_HINT)
        return
      }
      setStatusMessage(result ? (again ? AGAIN_HINT : voxelHint(result.plane.axis, result.plane.orientation)) : ORBIT_HINT)
    }

    /** Ends an open float drag, handing orbit control back. The float stays pending, exactly
     * like the 2D tool — a later tap bakes it, Escape bakes it, further drags keep moving it. */
    function endFloatDrag() {
      if (!floatDrag) return
      floatDrag = null
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    const onPointerLeave = () => {
      lastCellKey = null
      lastFaceKey = null
      lastSelectTap = null
      setHoverCell(null, null)
      setHoveredFace(null)
      setStatusMessage(null)
      dom.style.cursor = ''
      endMaterialDrag()
      endSelectDrag()
      endFloatDrag()
      // A leave mid-pose drops the drag where it is (the pose is already live in the store).
      if (poseDrag) {
        poseDrag = null
        useAppStore.getState().setPoseDragging(false)
        if (controlsRef.current) controlsRef.current.enabled = true
      }
      if (pendingPoseDrag) {
        pendingPoseDrag = null
        if (controlsRef.current) controlsRef.current.enabled = true
      }
      // A leave mid-paint commits the sweep as its one undo step (pointer capture makes
      // this rare — a capture loss without up/cancel).
      endPaintTouchDrag(true)
      // A leave mid-move drops the model where it is (endMove self-guards when never begun).
      if (moveDrag) {
        moveDrag = null
        useAppStore.getState().endMove()
      }
      // An unmoved wand grab is just a press — hand orbit control back; release resolves as a tap.
      pendingWandDrag = null
      pendingSelectGrab = null
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    const onPointerUp = (e: PointerEvent) => {
      // A pending pose press that never crossed the drag threshold resolves as a plain tap
      // below (plane navigation / rig select) — just disarm here and fall through.
      if (pendingPoseDrag && !poseDrag) {
        pendingPoseDrag = null
        if (controlsRef.current) controlsRef.current.enabled = true
      }
      // An open touch hold-to-paint drag commits as its one undo step — before the
      // downOutside/tap paths below, so the sweep is never double-applied as a tap.
      if (paintTouchDrag) {
        endPaintTouchDrag(true)
        down = null
        return
      }
      // Open pose drag: release ends it (the pose is already live in the store — nothing to
      // commit, and posing is preview, not undoable). Skips the tap path below so a ring
      // press never navigates the plane.
      if (poseDrag) {
        poseDrag = null
        useAppStore.getState().setPoseDragging(false)
        if (controlsRef.current) controlsRef.current.enabled = true
        dom.style.cursor = ''
        down = null
        return
      }
      // Presses that missed the working cube orbit (or no-op as taps) — no gesture opened.
      // Exception: an unmoved outside tap in select mode clears the selection (2D parity —
      // tapping the margin clears there too). Both setters bake first, so a pending float
      // lands instead of stranding.
      if (downOutside) {
        const tapped = down !== null && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_DRAG_THRESHOLD_PX
        down = null
        lastSelectTap = null
        if (tapped && e.button === 0 && activeToolRef.current === 'select') {
          const st = useAppStore.getState()
          if (st.selectedCells.size > 0 || st.selection) {
            st.setSelectedCells(new Set())
            st.setSelection(null)
          }
        }
        return
      }
      // Open whole-model move: a drag drops the model as one undo step; a tap (never begun)
      // orients the construction plane like a plain model click instead.
      if (moveDrag) {
        const drag = moveDrag
        moveDrag = null
        if (controlsRef.current) controlsRef.current.enabled = true
        down = null
        if (drag.begun) {
          useAppStore.getState().endMove()
          return
        }
        const hit = resolveFaceHit(e.clientX, e.clientY)
        if (hit) {
          useAppStore.getState().handleVoxelFaceClick(hit.key, hit.plane.axis, hit.plane.orientation, hit.plane.offset)
        }
        return
      }
      if (materialDrag) {
        endMaterialDrag()
        down = null
        return
      }
      // Open float drag: drop it — bakes immediately (one undo step, zanpo-style) and the 3D
      // set follows to the placed cells. A tap (no move) on a paste ghost lands here too and
      // simply drops it in place.
      if (floatDrag) {
        const drag = floatDrag
        endFloatDrag()
        down = null
        const st = useAppStore.getState()
        const originNow = st.floatOrigin
        st.bakeFloatIfAny()
        if (originNow) {
          const du = originNow.originU - drag.originU
          const dv = originNow.originV - drag.originV
          const plane = planeRef.current
          const extent = st.meta.gridExtent
          const next = new Set<CellKey>()
          for (const key of drag.cells3D) {
            const c = decodeKey(key)
            const { u, v } = pixelFromGridCoord(plane, c)
            const nc = gridCoordFromPixel(plane, u + du, v + dv)
            nc[axisIndex(plane.axis)] = c[axisIndex(plane.axis)]
            if (withinWorkingBounds(nc, extent)) next.add(encodeKey(...nc))
          }
          st.setSelectedCells(next)
        }
        return
      }
      // Unmoved wand grab: clear it and fall through — a sub-threshold release resolves as a
      // normal wand tap below (two-stage timing intact).
      if (pendingWandDrag) {
        pendingWandDrag = null
        if (controlsRef.current) controlsRef.current.enabled = true
      }
      // Unmoved select grab: clear it and note the press started inside the selection (a tap
      // there keeps everything — 2D parity — instead of reselecting; double-clicks still flood).
      const wasSelectGrab = pendingSelectGrab !== null
      if (pendingSelectGrab) {
        pendingSelectGrab = null
        if (controlsRef.current) controlsRef.current.enabled = true
      }
      // Open marquee: commit the drag as the full slice window (occupied or empty) as an
      // explicit set — never other depths. (Taps select the voxel instead — see below.)
      // Bakes any pending float first.
      if (selectDrag) {
        const drag = selectDrag
        selectDrag = null
        selectPreviewEnd = null
        if (controlsRef.current) controlsRef.current.enabled = true
        // A select tap (no drag) replaces the selection with the tapped voxel (reorienting
        // first, like a plain model click) — 2D parity, so the tap always lands visibly
        // instead of going dead on an already-placed plane.
        const tapped = down !== null && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_DRAG_THRESHOLD_PX
        down = null
        const hit = resolveFaceHit(e.clientX, e.clientY)
        const end: Coord | null = hit ? decodeKey(hit.key) : resolveEmptyCell(e.clientX, e.clientY)
        const st = useAppStore.getState()
        // The live preview made the box track the drag; the commit below takes over from here.
        st.setSelectedCellsPreview(null)
        if (!end) return
        // Select taps (selectDrag only ever opens in 3D-only with the select tool): 2D parity —
        // a tap replaces the selection with the tapped voxel. Plain taps reorient first, like a
        // plain model click (the reorient clears stale selections via the plane setters; the
        // fresh single-voxel set lands after); shift-taps union and never move the plane; a rapid
        // second tap flood-selects the plane slice instead.
        if (tapped && hit) {
          const now = Date.now()
          if (lastSelectTap && now - lastSelectTap.time <= WAND_DOUBLE_TAP_MS && lastSelectTap.key === hit.key) {
            lastSelectTap = null
            // Shift-double-click unions the flood region instead of replacing.
            st.applySliceWandAt(decodeKey(hit.key), e.shiftKey)
            // Kill the same-face-click-again memory (set by the first tap's reorient) so the
            // next same-face tap re-lands instead of advancing the plane off the selection —
            // repeat double-clicks then idempotently re-select it.
            useAppStore.setState((s) => { s.objectModeTarget = null })
            return
          }
          lastSelectTap = { time: now, key: hit.key }
          if (e.shiftKey) {
            st.setSelectedCells(new Set([...st.selectedCells, hit.key]))
            return
          }
          st.handleVoxelFaceClick(hit.key, hit.plane.axis, hit.plane.orientation, hit.plane.offset)
          st.setSelectedCells(new Set([hit.key]))
          return
        }
        // A real drag commits (not a tap): any pending double-click tap is void.
        lastSelectTap = null
        const keys = windowSliceCells(planeRef.current, drag.start, end, st.meta.gridExtent)
        // Shift unions the window into the existing selection (expanding its box); otherwise the
        // drag replaces. A shift-held empty window leaves the selection alone instead of clearing.
        if (keys.length > 0) {
          st.setSelectedCells(e.shiftKey ? new Set([...st.selectedCells, ...keys]) : new Set(keys))
        } else if (!e.shiftKey) {
          st.clearSelectedCells()
        }
        return
      }
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > CLICK_DRAG_THRESHOLD_PX) return // treat as an orbit drag, not a click
      // In 3D-only layout the blocking tools never set the plane — taps apply the tool
      // instead (in split layout this branch never runs: the viewport is orbit-only).
      // Only the left button taps (right/middle are orbit/dolly now).
      if (isBlocking()) {
        if (e.button !== 0) return
        applyBlockingTap(e.clientX, e.clientY, e.shiftKey, wasSelectGrab)
        return
      }

      // Marker tool never sets the plane — taps drop a new marker on the hit cell (on the
      // active slice when empty space was hit), recolor a different-colored marker to the
      // active color, or delete a same-colored one. One undo stroke per tap.
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
          // Self-bracketing actions are safe here — no stroke is open (unlike the 2D tool,
          // which mutates inside its own stroke).
          if (existing.color !== store.activeMarkerColor) store.setMarkerColor(existing.id, store.activeMarkerColor)
          else store.deleteMarker(existing.id)
          return
        }
        store.bakeFloatIfAny()
        store.beginStroke()
        // Face hits capture the hit face's basis; empty-space taps fall back to the active plane.
        store.addMarker(coord, result ? { axis: result.plane.axis, orientation: result.plane.orientation } : undefined)
        store.commitStroke()
        return
      }

      // Rig and pivot tools are 2D-only in Animate mode — the 3D view never edits, so taps
      // with them fall through to plane navigation below like any other orbit tap (with one
      // exception: a second tap on the same face selects the rig box instead of advancing —
      // see handleVoxelFaceClick).

      // Fill owns its taps in 3D-only layout and never moves the construction plane: a
      // committed selection fills with the brush wherever the click landed; otherwise a
      // voxel tap flood-fills material (color only — like the material tool, geometry
      // untouched) and an empty tap fills the plane slice at that UV.
      if (activeToolRef.current === 'fill' && useAppStore.getState().layoutMode === '3d-only') {
        if (e.button !== 0) return
        const st = useAppStore.getState()
        if (st.selectedCells.size > 0 || st.selection) {
          st.fillSelection()
          return
        }
        const hit = resolveFaceHit(e.clientX, e.clientY)
        const coord: Coord | null = hit ? decodeKey(hit.key) : resolveEmptyCell(e.clientX, e.clientY)
        if (!coord) return
        st.floodFillCellsAt(coord, e.altKey)
        return
      }

      const result = resolveFaceHit(e.clientX, e.clientY)
      // Pose tool taps never touch the construction plane (posing needs a stable frame):
      // click selects the tapped rig, empty space clears — plain click-to-select semantics.
      if (modeRef.current === 'animate' && activeToolRef.current === 'pose') {
        const st = useAppStore.getState()
        if (result) {
          const id = rigIdForCoord(st.rigBoxes, decodeKey(result.key))
          if (id && id !== st.selectedRigBoxId) st.selectRigBox(id)
        } else if (st.selectedRigBoxId) {
          st.selectRigBox(null)
        }
        useAppStore.setState((s) => { s.objectModeTarget = null })
        return
      }
      if (!result) return
      // A committed selection owns the plane: mouse clicks never move it (explicit wheel/UI
      // plane changes clear the selection instead — see the plane setters).
      {
        const st = useAppStore.getState()
        if (st.selectedCells.size > 0 || st.selection) {
          useAppStore.setState((s) => { s.objectModeTarget = null })
          return
        }
      }
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

/**
 * Publishes the main camera's orientation to the brush-preview mini-canvas once per frame
 * (see `brushViewSync.ts`). Mounted unconditionally — one quaternion copy per frame is free.
 */
function BrushViewSync() {
  useFrame(({ camera }) => {
    brushViewQuaternion.copy(camera.quaternion)
  })
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
  const layoutMode = useAppStore((s) => s.layoutMode)
  // Touch hold-to-paint: while the PlaneEdgeSlider hold button is down, orbit locks so the
  // stylus/finger paints onto the construction plane instead of rotating the camera.
  const touchPaintHold = useAppStore((s) => s.touchPaintHold)
  const containerRef = useRef<HTMLDivElement>(null)
  usePlaneLayerScroll(containerRef)
  const [showExposure, setShowExposure] = useState(false)
  const compassNeedleRef = useRef<HTMLDivElement>(null)

  const textureMode = mode === 'texture'
  const animateMode = mode === 'animate'
  const poseToolActive = useAppStore((s) => s.mode === 'animate' && s.activeTool === 'pose')
  const hasAnimations = animateMode && hasActiveAnimations(animSettings)
  const animateModelHidden = useAppStore((s) => s.mode === 'animate' && s.animateModelView === 'hidden')
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  // Looped joints drive the same pose-view scene graph as gizmo posing (per-box groups,
  // zero rebuilds per frame) — the view stays live while any loop exists, even with an
  // empty pose. Slice loops keep their own legacy view; rig loops take over when present.
  const hasRigLoops = animateMode && hasActiveRigLoops(rigBoxes)
  // Pose preview takes over the model views while a non-empty pose exists (hidden blanks it
  // like the others); the static views stay mounted with frozen builds underneath. The drag
  // latch keeps it mounted through exact-zero crossings mid-gesture.
  const poseActive = useAppStore((s) => s.mode === 'animate' && (s.poseRotations.size > 0 || s.poseDragging) && s.animateModelView !== 'hidden') || (hasRigLoops && !animateModelHidden)
  // Exactly one model view is live at a time; the others stay mounted but hidden with frozen
  // builds (see useActiveMemo), so mode switches never tear down GPU resources.
  // (textureMode and hasAnimations are mutually exclusive — hasAnimations requires animateMode.)
  // Animate's hidden model view blanks both (rig boxes, pivots, and plane chrome stay up).
  const voxelViewsActive = !textureMode && !hasAnimations && !animateModelHidden && !poseActive
  const animatedModelActive = !textureMode && hasAnimations && !animateModelHidden && !poseActive
  // The off-mode views mount on first visit, then stay mounted: startup never pays for views
  // never opened (the app always boots into Model mode), and later tab switches are free.
  // Monotonic latches — safe to set during render.
  const seenTexture = useRef(textureMode)
  const seenAnimated = useRef(animatedModelActive)
  const seenPose = useRef(poseActive)
  if (textureMode) seenTexture.current = true
  if (animatedModelActive) seenAnimated.current = true
  if (poseActive) seenPose.current = true

  return (
    <div
      ref={containerRef}
      data-tour="viewport3d"
      className="relative h-full min-w-0 bg-neutral-900"
      onPointerEnter={() => setStatusMessage(ORBIT_HINT)}
      onPointerLeave={() => setStatusMessage(null)}
    >
      <Canvas camera={{ position: cameraPosForExtent(gridExtent, voxelScaleY), fov: 45 }} gl={{ antialias: true, localClippingEnabled: true }}>
        <ToneMappingController exposure={exposure} />
        <CameraRig controlsRef={orbitControlsRef} />
        <color attach="background" args={['#111114']} />
        <SceneLighting />
        <SceneEnvironment />
        {/* All working-volume contents live under the Y-scale group so voxels render flat/tall
          while every consumer keeps speaking unit-cube grid coordinates (picking resolves through
          the scaled parent back to grid-space cell keys). The heavy model views stay mounted
          across mode switches (visibility-toggled, builds frozen while hidden) so tabbing between
          Model/Animate/Texture never disposes and rebuilds their GPU resources — only the
          lightweight per-mode chrome mounts conditionally. */}
        <group scale={[1, voxelScaleY, 1]}>
          <VoxelInstancedMeshes ref={managerRef} visible={voxelViewsActive} />
          <OptimizedMeshView active={voxelViewsActive} />
          {seenAnimated.current && <AnimatedModelView active={animatedModelActive} />}
          {seenPose.current && <RigPoseView active={poseActive} />}
          {seenTexture.current && <TexturedModelView active={textureMode} />}
          {!textureMode && (
            <>
              {/* Pose mode hides the construction plane chrome entirely (grid, plane-cell
                ghost, and the origin widget that re-orients the plane on click) — posing
                needs a stable frame, and taps there never touch the plane. */}
              {!poseToolActive && <ConstructionPlaneVisual />}
              <ProjectBoundsBox />
              {!poseToolActive && <VoxelFaceHighlight />}
              {!poseToolActive && <VoxelGhostPreview />}
              <FloatGhostPreview />
              <SelectionHighlight />
              <SelectionBox3D />
              {!poseToolActive && <ConstructionPlaneGizmo />}
              <PivotGizmo />
              <PoseGizmo />
              <RigLinkLines />
              <MarkersView />
              <RigBoxHighlight />
            </>
          )}
          {textureMode && (
            <>
              <TextureFaceHighlight />
              <BoundingBoxFaceSelector />
            </>
          )}
        </group>
        {!textureMode && (
          <VoxelInteractionHandler managerRef={managerRef} controlsRef={orbitControlsRef} />
        )}
          <OrbitControls
            ref={orbitControlsRef}
            makeDefault
            enabled={!touchPaintHold}
            enableDamping
            dampingFactor={0.12}
            minDistance={2}
            maxDistance={150}
            mouseButtons={{
              LEFT: THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.DOLLY,
              // In 3D-only layout the left button is busy tapping tools, so right-drag takes over
              // orbiting (panning stays on touch gestures). Split layout is orbit-only.
              RIGHT: layoutMode === '3d-only' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
            }}
          />
          <CompassTracker iconRef={compassNeedleRef} />
          <BrushViewSync />
      </Canvas>
      <ViewOptionsOverlay
        onResetCamera={() => orbitControlsRef.current?.reset()}
        showExposure={showExposure}
        onToggleExposure={() => setShowExposure((v) => !v)}
      />
      <SettingsPalette />
      {animateMode && <RiggingPalette />}
      {showExposure && <ExposureSlider />}
      <BrushPreview />
      <div className="absolute left-5 top-5 z-40">
        <CompassIcon iconRef={compassNeedleRef} />
      </div>
    </div>
  )
}
