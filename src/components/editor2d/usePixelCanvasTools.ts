import { useCallback, useEffect, useRef, useState } from 'react'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { toNormalizedPointerEvent } from '@/engine/input/PointerInputController'
import { toolMap } from '@/engine/tools'
import type { ToolContext, ToolDragState } from '@/engine/tools/types'
import { useAppStore } from '@/store/useAppStore'
import type { SelectionRegion } from '@/store/types'
import type { CanvasPan, CanvasSize } from './cameraTransform'
import { clampPan, screenToWorld } from './cameraTransform'
import { BASE_CELL_PX, clampZoom, PINCH_ZOOM_SENSITIVITY, WHEEL_ZOOM_SENSITIVITY } from './canvasConstants'

const PAN_DRAG_THRESHOLD_PX = 3

function pixelToCell(canvas: HTMLCanvasElement, clientX: number, clientY: number, size: CanvasSize, pan: CanvasPan, zoom: number): [number, number] {
  const rect = canvas.getBoundingClientRect()
  const [wu, wv] = screenToWorld(clientX - rect.left, clientY - rect.top, size, pan, zoom)
  return [Math.floor(wu), Math.floor(wv)]
}

/**
 * Owns pointer-input wiring for the 2D canvas: builds a fresh `ToolContext` every render (mirrored
 * into a ref so the stable pointer callbacks below never read a stale closure) and dispatches to
 * `toolMap[activeTool]`, mirroring trixelart's `use-interaction.ts` pattern. All per-tool logic
 * lives in `engine/tools/*`; this hook is purely the React-side adapter connecting it to the
 * Zustand store and to the `<canvas>` element's native pointer events.
 *
 * Also owns the canvas's camera (pan/zoom) and its measured CSS size (ResizeObserver, since the
 * canvas fills its container rather than being a fixed-size element the container scrolls) —
 * middle-click-drag pans and the wheel zooms, both handled here directly rather than through the
 * tool-dispatch table, mirroring how trixelart special-cases its camera pan at the dispatch site
 * ahead of `toolMap` lookup rather than making it a per-tool concern.
 */
export function usePixelCanvasTools(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const drag = useRef<ToolDragState>({ kind: 'idle' })
  const cloneSourceRef = useRef<[number, number] | null>(null)
  const cloneOffsetRef = useRef<[number, number] | null>(null)
  const hoverCellRef = useRef<[number, number] | null>(null)
  const panDragRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; hasMoved: boolean } | null>(null)

  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })
  const [pan, setPan] = useState<CanvasPan>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const sizeRef = useRef(size)
  sizeRef.current = size
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const [linePreview, setLinePreview] = useState<{ anchor: [number, number]; end: [number, number] } | null>(null)
  const [selectPreview, setSelectPreview] = useState<SelectionRegion | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const update = () => {
      const rect = canvas.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [canvasRef])

  // Native (non-passive) wheel listener — React's synthetic onWheel is passive by default, so
  // e.preventDefault() inside it silently fails to stop page scroll. `sizeRef`/`zoomRef` sidestep
  // stale-closure risk so this only needs to be attached once. Three gestures share this one
  // event, distinguished the same way SPEC's "wheel/trackpad pinch zooms, two-finger trackpad
  // pans" convention (already used by the 3D view's OrbitControls) works:
  //  - ctrl/meta+wheel: trackpad pinch (browsers synthesize this modifier for pinch gestures) —
  //    zoom, with its own much lower divisor since pinch deltas are tiny per-event.
  //  - plain wheel with a horizontal component: two-finger trackpad scroll — pan directly by the
  //    pixel delta (a real mouse wheel essentially never reports deltaX).
  //  - plain vertical-only wheel: a physical mouse wheel (or a perfectly vertical trackpad
  //    scroll, indistinguishable from a mouse wheel at the browser event level) — zoom.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      if (e.ctrlKey || e.metaKey) {
        const factor = Math.pow(1.1, -e.deltaY / PINCH_ZOOM_SENSITIVITY)
        const nextZoom = clampZoom(zoomRef.current * factor)
        setZoom(nextZoom)
        setPan((p) => clampPan(p, sizeRef.current, nextZoom))
        return
      }

      if (e.deltaX !== 0) {
        const cellPx = BASE_CELL_PX * zoomRef.current
        setPan((p) => clampPan({ x: p.x + e.deltaX / cellPx, y: p.y + e.deltaY / cellPx }, sizeRef.current, zoomRef.current))
        return
      }

      const factor = Math.pow(1.1, -e.deltaY / WHEEL_ZOOM_SENSITIVITY)
      const nextZoom = clampZoom(zoomRef.current * factor)
      setZoom(nextZoom)
      setPan((p) => clampPan(p, sizeRef.current, nextZoom))
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [canvasRef])

  const model = useAppStore((s) => s.model)
  const plane = useAppStore((s) => s.plane)
  const activeLayer = useAppStore((s) => s.activeLayer)
  const activePaletteSlot = useAppStore((s) => s.activePaletteSlot)
  const selection = useAppStore((s) => s.selection)
  const floatContent = useAppStore((s) => s.floatContent)
  const floatOrigin = useAppStore((s) => s.floatOrigin)
  const clipboard = useAppStore((s) => s.clipboard)
  const activeTool = useAppStore((s) => s.activeTool)

  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool

  const store = useAppStore.getState() // action references are stable for the store's lifetime
  const setHoverCell = store.setHoverCell // pulled out so it can be a genuine, listable useCallback dep

  const ctx: ToolContext = {
    model, plane, activeLayer, activePaletteSlot, selection, floatContent, floatOrigin, clipboard,
    paintColorCell: store.paintColorCell,
    paintChamferCell: store.paintChamferCell,
    eraseCell: store.eraseCell,
    floodFill: store.floodFill,
    cloneStampCell: store.cloneStampCell,
    setActivePaletteSlot: store.setActivePaletteSlot,
    setSelection: store.setSelection,
    liftSelectionToFloat: store.liftSelectionToFloat,
    moveFloatTo: store.moveFloatTo,
    transformFloat: store.transformFloat,
    bakeFloatIfAny: store.bakeFloatIfAny,
    beginStroke: store.beginStroke,
    commitStroke: store.commitStroke,
    linePreview,
    setLinePreview,
    selectPreview,
    setSelectPreview,
    drag,
    cloneSourceRef,
    cloneOffsetRef,
  }
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      if (e.button === 2) {
        e.preventDefault()
        panDragRef.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, hasMoved: false }
        canvas.setPointerCapture(e.pointerId)
        return
      }

      const cell = pixelToCell(canvas, e.clientX, e.clientY, size, pan, zoom)
      hoverCellRef.current = cell
      setHoverCell(gridCoordFromPixel(ctxRef.current.plane, cell[0], cell[1]), null)
      canvas.setPointerCapture(e.pointerId)
      toolMap[activeToolRef.current].onDown?.(ctxRef.current, toNormalizedPointerEvent(e, cell))
    },
    [canvasRef, size, pan, zoom, setHoverCell],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const panDrag = panDragRef.current
      if (panDrag) {
        const dx = e.clientX - panDrag.lastX
        const dy = e.clientY - panDrag.lastY
        panDrag.lastX = e.clientX
        panDrag.lastY = e.clientY
        if (Math.hypot(e.clientX - panDrag.startX, e.clientY - panDrag.startY) > PAN_DRAG_THRESHOLD_PX) panDrag.hasMoved = true
        const cellPx = BASE_CELL_PX * zoom
        setPan((p) => clampPan({ x: p.x + dx / cellPx, y: p.y + dy / cellPx }, size, zoom))
        return
      }

      const cell = pixelToCell(canvas, e.clientX, e.clientY, size, pan, zoom)
      const prevCell = hoverCellRef.current
      hoverCellRef.current = cell
      // Only push a store update when the hovered *cell* actually changes, not on every mousemove
      // tick within it — mirrors the same dedup on the 3D side (Viewport3D.tsx).
      if (!prevCell || prevCell[0] !== cell[0] || prevCell[1] !== cell[1]) {
        setHoverCell(gridCoordFromPixel(ctxRef.current.plane, cell[0], cell[1]), null)
      }
      toolMap[activeToolRef.current].onMove?.(ctxRef.current, toNormalizedPointerEvent(e, cell))
    },
    [canvasRef, size, pan, zoom, setHoverCell],
  )

  const onPointerLeave = useCallback(() => {
    hoverCellRef.current = null
    setHoverCell(null, null)
  }, [setHoverCell])

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const panDrag = panDragRef.current
      if (panDrag) {
        panDragRef.current = null
        canvas.releasePointerCapture(e.pointerId)
        // A stationary right-click (no drag) erases the cell under the cursor — a quick-erase
        // shortcut on the paint/erase tools now that right-click-drag means "pan the camera."
        if (!panDrag.hasMoved && (activeToolRef.current === 'paint' || activeToolRef.current === 'erase')) {
          const cell = pixelToCell(canvas, e.clientX, e.clientY, size, pan, zoom)
          const c = ctxRef.current
          c.bakeFloatIfAny()
          c.beginStroke()
          c.eraseCell(gridCoordFromPixel(c.plane, cell[0], cell[1]), c.activeLayer)
          c.commitStroke()
        }
        return
      }

      const cell = pixelToCell(canvas, e.clientX, e.clientY, size, pan, zoom)
      toolMap[activeToolRef.current].onUp?.(ctxRef.current, toNormalizedPointerEvent(e, cell))
      canvas.releasePointerCapture(e.pointerId)
    },
    [canvasRef, size, pan, zoom],
  )

  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave, linePreview, selectPreview, hoverCellRef, size, pan, zoom }
}
