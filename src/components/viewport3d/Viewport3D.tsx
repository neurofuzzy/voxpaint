import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { decodeKey, encodeKey, effectiveExtent, viewOriginShift, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { CellKey, Coord } from '@/engine/grid/types'
import { hasActiveAnimations } from '@/engine/animation/animationLayers'
import type { InstancingManager } from '@/engine/instancing/InstancingManager'
import { gridCoordFromPixel, pixelFromGridCoord, planeFromFaceHit } from '@/engine/plane/constructionPlane'
import { axisIndex, outwardNormal } from '@/engine/plane/planeGeometry'
import { voxelKindForCell } from '@/engine/tools/eyedropperTool'
import { marqueeSelection } from '@/engine/tools/select3D'
import { windowSliceCells } from '@/engine/tools/cellSetOps'
import { isCellSelected } from '@/engine/tools/selectionMask'
import { useAppStore } from '@/store/useAppStore'
import { usePlaneLayerScroll } from '@/components/usePlaneLayerScroll'
import { AnimatedModelView } from './AnimatedModelView'
import { BoundingBoxFaceSelector } from './BoundingBoxFaceSelector'
import { CompassIcon, CompassTracker } from './Compass'
import { ViewportModeToggle } from './ViewportModeToggle'
import { BrushPreview } from './BrushPreview'
import { brushViewQuaternion } from './brushViewSync'
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
import { SelectionBox3D } from './SelectionBox3D'
import { TexturedModelView } from './TexturedModelView'
import { TextureFaceHighlight } from './TextureFaceHighlight'
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
 * When the cursor hits no voxel face, hover falls back to the construction-plane cell under the
 * cursor (`resolveEmptyCell`), so the ghost preview still marks what a click would paint.
 *
 * In 3D Edit mode (`edit3D`) with a paint/erase/eyedropper/material/select/wand tool active,
 * taps dispatch the tool straight onto voxel faces — paint adds the neighbor cell across the
 * face, erase deletes the cell, eyedropper samples its color and voxel type, material recolors
 * the cell, wand selects connected color (whole touching component on rapid re-tap). A select
 * tap only reorients the construction plane like a plain model click — taps never select and
 * never lift; selection (and moves) need a real drag. Paint/erase/eyedropper are
 * tap-only (drags orbit, so sweeps can't spray voxels); material recolors in place and is safe to
 * drag, bracketed as one undo stroke with orbit suppressed until pointer-up; select and wand
 * capture left-drag on a selected voxel to lift and move it in the plane's UV axes (Alt: full
 * depth) — wand defers the lift past the tap threshold so taps keep working, otherwise select
 * opens a plane-slice marquee — right-drag still orbits.
 * Empty-space paint taps start a blob on the active slice. Every other tool keeps the
 * plane-setting behavior in both modes.
 */
const ORBIT_HINT = 'Orbit: left-drag to rotate · right-drag: pan · scroll: zoom'
const EDIT_ORBIT_HINT = 'Edit 3D: click a face to apply the tool · drag empty space to orbit · right-drag: orbit'

/** Tools that apply straight onto voxel faces in 3D Edit mode (everything else keeps the
 * click-to-set-plane behavior there). Paint/erase/eyedropper are tap-only — drags orbit, so a
 * sweep can never spray voxels along the raycast. Material only recolors existing voxels
 * (never adds), so it is safe to drag. Select and wand capture left-drag on a selected voxel
 * to lift and move it in the plane's UV axes (Alt: full depth) — wand defers the lift until
 * past the tap threshold so taps keep their two-stage click behavior; otherwise select opens a
 * plane-slice marquee on drag (a tap only reorients the plane, never selecting). Right-drag
 * still orbits, per the Edit convention. */
const BLOCKING_TOOLS = ['paint', 'erase', 'eyedropper', 'material', 'select', 'wand'] as const
type BlockingTool = (typeof BLOCKING_TOOLS)[number]

function editHint(tool: BlockingTool): string {
  if (tool === 'paint') return 'Click a face to paint a voxel · R rotates the brush'
  if (tool === 'erase') return 'Click a voxel to erase it'
  if (tool === 'material') return 'Click or drag to repaint · never adds voxels'
  if (tool === 'select') return 'Drag to marquee-select · drag inside to move · click sets the plane'
  if (tool === 'wand') return 'Click a component for its color · re-tap it quickly for the whole component · drag inside to move'
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
    // Open select marquee (Edit mode only): drag start cell on the active plane. Committed on
    // pointer-up — a plane-slice SelectionRegion in split, the full slice window (occupied or
    // empty) as an exact set in 3D-only; cancelled on pointer-leave. A tap (no drag) only
    // reorients the plane like a plain click — selection needs a real drag. Window selection
    // is strictly planar (volumetric selection belongs to the wand). Orbit suppressed until
    // pointer-up, like the material drag. The pending selection is mirrored to the store
    // preview every move so the 3D selection box tracks the drag live (`selectPreview` window
    // in split, `selectedCellsPreview` exact keys in 3D-only); `selectPreviewEnd` dedupes
    // repeat resolves on one cell.
    let selectDrag: { start: Coord } | null = null
    let selectPreviewEnd: Coord | null = null
    // Open select float-drag (Edit mode only): pointer went down on a selected voxel. The
    // lift waits until the pointer actually moves past the tap threshold (mirroring the
    // wand's pendingWandDrag), so taps resolve as plain clicks on release instead of
    // churning a lift-and-bake roundtrip; crossing the threshold lifts and converts to a
    // float drag that follows the pointer in the plane's UV axes. Release keeps the float
    // pending, exactly like the 2D tool — orbit suppressed throughout.
    let floatDrag: { startU: number; startV: number; originU: number; originV: number; cells3D: Set<CellKey> | null } | null = null
    // Armed select grab (Edit mode only): pointer went down on a selected voxel with no live
    // float, lift still pending. A tap releases through the normal tap path (reorienting the
    // plane like a plain click); movement past the threshold converts to `floatDrag` above.
    let pendingSelectGrab: { startU: number; startV: number; alt: boolean } | null = null
    // Pending wand grab (Edit mode only): pointer went down on a selected voxel with the wand.
    // Unlike select it must NOT lift yet — a tap here is a two-stage wand click, so the lift
    // waits until the pointer actually moves past the tap threshold, then converts to floatDrag.
    let pendingWandDrag: { startU: number; startV: number } | null = null

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
     * across the face, erase deletes the cell, eyedropper samples its color and voxel type,
     * material recolors the cell, select reorients the plane without touching the selection,
     * wand selects connected color (whole component on rapid re-tap; empty space clears the
     * selection). Paint/erase/material bracket their own single-cell undo stroke; eyedropper,
     * select and wand mutate no model. Paint/erase/eyedropper/wand drags never apply (every
     * pointer crossing would spray voxels along the raycast), so movement always
     * orbits — material alone drags (see onPointerMove); select commits via its own drag.
     *
     * Paint placement crosses the clicked face, but orientation ALWAYS inherits the active
     * construction plane — never the raycast face — so the write matches the brush preview. */
    function applyBlockingTap(clientX: number, clientY: number) {
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
      // Select: a tap only reorients the plane like a plain model click — taps never select
      // (and never lift); selection needs a real drag.
      if (tool === 'select') {
        if (result) store.handleVoxelFaceClick(result.key, result.plane.axis, result.plane.orientation, result.plane.offset)
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
        const normal = outwardNormal(result.plane.axis, result.plane.orientation)
        const target: Coord =
          tool === 'paint' ? [x + normal[0], y + normal[1], z + normal[2]] : [x, y, z]
        store.bakeFloatIfAny()
        store.beginStroke()
        if (tool === 'paint') {
          const activePlane = planeRef.current
          store.paintCellAtCoord(target, activePlane.axis, activePlane.orientation)
        } else if (tool === 'erase') store.eraseCellAtCoord(target)
        // Any other tool (e.g. select, whose gestures commit via selectDrag) never reaches here,
        // but must never erase — fail closed.
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
      if (!isBlocking() || e.button !== 0 || !e.isPrimary) return
      // Select captures left-drag (right-drag still orbits, per the Edit convention). A press
      // on a selected voxel lifts the selection and drags it in the plane's UV axes instead of
      // marqueeing — mirroring the 2D tool. Otherwise the marquee opens from the hit voxel (else
      // the plane cell under the cursor); a parallel ray leaves the gesture to orbit. In 3D-only
      // layout the grab tests the independent voxel set and lifts exact cells; in split it tests
      // the plane region and lifts that (Alt: full depth).
      if (activeToolRef.current === 'select') {
        const store = useAppStore.getState()
        const activePlane = planeRef.current
        const hit = resolveFaceHit(e.clientX, e.clientY)
        const is3D = store.layoutMode === '3d-only'
        // Grab test: explicit-set membership in 3D-only, plane-region containment in split.
        // (A pending 2D float keeps tracking the selection region, so the split branch also
        // continues a float dragged earlier rather than lifting twice. The 3D branch only ever
        // lifts fresh — a pending float there belongs to a 2D paste, so a press falls through
        // to the marquee, whose commit bakes it first.)
        let grabUV: { u: number; v: number } | null = null
        if (hit) {
          if (is3D) {
            if (!store.floatContent && store.selectedCells.has(hit.key)) {
              grabUV = pixelFromGridCoord(activePlane, decodeKey(hit.key))
            }
          } else {
            const uv = pixelFromGridCoord(activePlane, decodeKey(hit.key))
            if ((store.floatContent || store.selection) && store.selection && isCellSelected(store.selection, uv.u, uv.v)) grabUV = uv
          }
        }
        if (grabUV) {
          const { u, v } = grabUV
          if (store.floatContent) {
            // Continue the pending float immediately (taps keep dragging it, drops leave it
            // pending) — only when there is one to continue; otherwise arm below.
            const origin = useAppStore.getState().floatOrigin
            if (origin) {
              floatDrag = {
                startU: u,
                startV: v,
                originU: origin.originU,
                originV: origin.originV,
                cells3D: is3D ? new Set(store.selectedCells) : null,
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
              setStatusMessage('Dragging selection in the plane — release to drop it (still pending)')
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
        // slice window in 3D-only, the plane window in split (each mirrors its commit).
        {
          const st = useAppStore.getState()
          if (st.layoutMode === '3d-only') {
            st.setSelectedCellsPreview(new Set(windowSliceCells(planeRef.current, start, start, st.meta.gridExtent)))
          } else {
            st.setSelectPreview(marqueeSelection(planeRef.current, start, start))
          }
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
        // Grab test mirrors select's: explicit-set membership in 3D-only, region containment
        // in split. Either arms the deferred drag; anything else falls through to the tap path.
        const grabbed = hit && (store.layoutMode === '3d-only'
          ? (!store.floatContent && store.selectedCells.has(hit.key)
            ? pixelFromGridCoord(planeRef.current, decodeKey(hit.key))
            : null)
          : store.selection
            ? (() => {
              const { u, v } = pixelFromGridCoord(planeRef.current, decodeKey(hit.key))
              return isCellSelected(store.selection!, u, v) ? { u, v } : null
            })()
            : null)
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
            setStatusMessage('Dragging selection in the plane — release to drop it (still pending)')
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
      // Pending wand grab: sub-threshold movement holds the press (a tap resolves via the normal
      // tap path on release); crossing the threshold lifts and converts to a float drag, flowing
      // into the branch below so the first over-threshold move displaces. Split lifts the plane
      // region (Alt: full depth); 3D-only lifts the exact voxel set (Alt ignored — the set already
      // spans every depth it covers).
      if (pendingWandDrag) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_DRAG_THRESHOLD_PX) {
          const store = useAppStore.getState()
          const is3D = store.layoutMode === '3d-only'
          if (!store.floatContent) {
            if (is3D) store.liftCellsToFloat(store.selectedCells)
            else store.liftSelectionToFloat(e.altKey)
          }
          const origin = useAppStore.getState().floatOrigin
          if (origin) {
            floatDrag = {
              startU: pendingWandDrag.startU,
              startV: pendingWandDrag.startV,
              originU: origin.originU,
              originV: origin.originV,
              cells3D: is3D ? new Set(store.selectedCells) : null,
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
      // Split lifts the plane region (Alt at press: full depth); 3D-only lifts the exact
      // voxel set (Alt ignored — the set already spans every depth it covers).
      if (pendingSelectGrab) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_DRAG_THRESHOLD_PX) {
          const store = useAppStore.getState()
          const is3D = store.layoutMode === '3d-only'
          if (!store.floatContent) {
            if (is3D) store.liftCellsToFloat(store.selectedCells)
            else store.liftSelectionToFloat(pendingSelectGrab.alt)
          }
          const origin = useAppStore.getState().floatOrigin
          if (origin) {
            floatDrag = {
              startU: pendingSelectGrab.startU,
              startV: pendingSelectGrab.startV,
              originU: origin.originU,
              originV: origin.originV,
              cells3D: is3D ? new Set(store.selectedCells) : null,
            }
            setStatusMessage('Dragging selection in the plane — release to drop it (still pending)')
          }
          pendingSelectGrab = null
        } else {
          return
        }
      }
      // Open float drag: reposition the pending float from the plane cell under the cursor, in
      // the plane's UV axes. 3D exact-set moves skip the 2D selection rewrite. The float ghost
      // is the live feedback; hover stays cleared.
      if (floatDrag) {
        const cell = resolveEmptyCell(e.clientX, e.clientY)
        if (cell) {
          const { u, v } = pixelFromGridCoord(planeRef.current, cell)
          const st = useAppStore.getState()
          const nu = floatDrag.originU + (u - floatDrag.startU)
          const nv = floatDrag.originV + (v - floatDrag.startV)
          if (floatDrag.cells3D) st.moveFloatCellsTo(nu, nv)
          else st.moveFloatTo(nu, nv)
        }
        return
      }
      // Open marquee drag: mirror the pending selection to the store preview so the 3D
      // selection box grows with the drag (committed on pointer-up): the full slice window
      // in 3D-only, the plane window in split. Hover stays cleared until release.
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
          if (st.layoutMode === '3d-only') {
            st.setSelectedCellsPreview(new Set(windowSliceCells(planeRef.current, selectDrag.start, end, st.meta.gridExtent)))
          } else {
            st.setSelectPreview(marqueeSelection(planeRef.current, selectDrag.start, end))
          }
        }
        return
      }

      const result = resolveFaceHit(e.clientX, e.clientY)

      // No voxel face under the cursor: fall back to the construction plane, so the ghost
      // preview still marks the cell a click would paint (empty-space paint starts a blob on
      // the active slice — see applyBlockingTap). Null when the ray runs parallel to the plane.
      const empty = result ? null : resolveEmptyCell(e.clientX, e.clientY)
      const hoverCoord = result ? decodeKey(result.key) : empty
      const cellKey = result?.key ?? (empty ? encodeKey(...empty) : null)
      if (cellKey !== lastCellKey) {
        lastCellKey = cellKey
        setHoverCell(hoverCoord, null)
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
        // Select and wand both act from empty space too, so their hints show even with no hit.
        setStatusMessage(tool === 'select' || tool === 'wand' ? editHint(tool) : result ? editHint(tool) : EDIT_ORBIT_HINT)
        return
      }

      const target = objectModeTargetRef.current
      const again = result && target
        && result.key === target.cellKey
        && result.plane.axis === target.axis
        && result.plane.orientation === target.orientation
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
      setHoverCell(null, null)
      setHoveredFace(null)
      setStatusMessage(null)
      endMaterialDrag()
      endSelectDrag()
      endFloatDrag()
      // An unmoved wand grab is just a press — hand orbit control back; release resolves as a tap.
      pendingWandDrag = null
      pendingSelectGrab = null
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    const onPointerUp = (e: PointerEvent) => {
      if (materialDrag) {
        endMaterialDrag()
        down = null
        return
      }
      // Open float drag: drop it. 2D floats stay pending (Escape/tap bakes); 3D exact-set moves
      // bake immediately (one undo step, zanpo-style) and the 3D set follows to the placed cells.
      // Float drags only open past the tap threshold, so an unmoved release can never land here.
      if (floatDrag) {
        const drag = floatDrag
        endFloatDrag()
        down = null
        if (drag.cells3D) {
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
        return
      }
      // Unmoved wand grab: clear it and fall through — a sub-threshold release resolves as a
      // normal wand tap below (two-stage timing intact).
      if (pendingWandDrag) {
        pendingWandDrag = null
        if (controlsRef.current) controlsRef.current.enabled = true
      }
      // Unmoved select grab: clear it and fall through — the tap below reorients the plane.
      if (pendingSelectGrab) {
        pendingSelectGrab = null
        if (controlsRef.current) controlsRef.current.enabled = true
      }
      // Open marquee: commit the drag. Split: plane-slice region, mirroring the 2D
      // select tool. 3D-only: the full slice window (occupied or empty) as an explicit set —
      // never other depths. (Taps with a face hit return above having reoriented the plane.)
      // Both bake any pending float first.
      if (selectDrag) {
        const drag = selectDrag
        selectDrag = null
        selectPreviewEnd = null
        if (controlsRef.current) controlsRef.current.enabled = true
        // A select tap (no drag) reorients the construction plane exactly like a plain
        // model click, then selects the clicked cell under its new plane — so the tap always
        // lands visibly instead of going dead on an already-placed plane.
        const tapped = down !== null && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_DRAG_THRESHOLD_PX
        down = null
        const hit = resolveFaceHit(e.clientX, e.clientY)
        const end: Coord | null = hit ? decodeKey(hit.key) : resolveEmptyCell(e.clientX, e.clientY)
        const st = useAppStore.getState()
        // The live preview made the box track the drag; the commit below takes over from here.
        st.setSelectPreview(null)
        st.setSelectedCellsPreview(null)
        if (!end) return
        // A select tap (no drag) only reorients the plane like a plain click — selection
        // needs a real drag, so no 1×1 is ever committed here.
        if (tapped && hit) {
          st.handleVoxelFaceClick(hit.key, hit.plane.axis, hit.plane.orientation, hit.plane.offset)
          return
        }
        if (st.layoutMode === '3d-only') {
          const keys = windowSliceCells(planeRef.current, drag.start, end, st.meta.gridExtent)
          if (keys.length > 0) st.setSelectedCells(new Set(keys))
          else st.clearSelectedCells()
        } else {
          st.setSelection(marqueeSelection(planeRef.current, drag.start, end))
        }
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

      const result = resolveFaceHit(e.clientX, e.clientY)
      if (!result) return
      // Fill paints on the tap as well (Edit mode only). A committed selection owns the tap:
      // the whole selection fills with the brush (the yellow box marks the target) using the
      // current plane first — only then does the plane land on the tapped face like any model
      // click, so split windows always fill on the plane they were drawn on. Without one,
      // flood from the tapped voxel as before.
      if (activeToolRef.current === 'fill' && edit3DRef.current) {
        const st = useAppStore.getState()
        if (st.selectedCells.size > 0 || st.selection) {
          st.fillSelection()
        } else if (st.layoutMode === '3d-only') {
          st.floodFillCellsAt(decodeKey(result.key), e.altKey)
        } else {
          const { u, v } = pixelFromGridCoord(useAppStore.getState().plane, decodeKey(result.key))
          if (e.altKey) st.floodFill3D(u, v)
          else st.floodFill(u, v)
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
            <TextureFaceHighlight />
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
              <SelectionBox3D />
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
          <BrushViewSync />
      </Canvas>
      <ViewOptionsOverlay
        onResetCamera={() => orbitControlsRef.current?.reset()}
        showExposure={showExposure}
        onToggleExposure={() => setShowExposure((v) => !v)}
      />
      <SettingsPalette />
      {showExposure && <ExposureSlider />}
      <BrushPreview />
      <div className="absolute left-5 top-5 z-40 flex items-center gap-2">
        <CompassIcon iconRef={compassNeedleRef} />
        <ViewportModeToggle />
      </div>
    </div>
  )
}
