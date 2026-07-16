import { useCallback, useEffect, useRef, useState } from 'react'
import { toNormalizedPointerEvent } from '@/engine/input/PointerInputController'
import { textureToolMap } from '@/engine/texture/textureTools'
import type { TextureToolContext, TextureDragState } from '@/engine/texture/textureTools'
import { faceSizeFor } from '@/engine/texture/types'
import { useAppStore } from '@/store/useAppStore'
import type { SelectionRegion } from '@/store/types'
import type { CanvasPan, CanvasSize } from './cameraTransform'
import { touchDistance, touchMidpoint } from './cameraTransform'
import { TOUCH_GESTURE_DELAY_MS } from './canvasConstants'
import { defaultTexZoomForExtent, TEXEL_BASE_PX, texClampPan, texClampZoom, texScreenToWorld } from './textureCanvasConstants'

const PAN_DRAG_THRESHOLD_PX = 3

/** Screen pixel → texel (u, v) on the active box face. */
function pixelToTexel(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  size: CanvasSize,
  pan: CanvasPan,
  zoom: number,
  texHalf: number,
): [number, number] {
  const rect = canvas.getBoundingClientRect()
  const [tu, tv] = texScreenToWorld(clientX - rect.left, clientY - rect.top, size, pan, zoom, texHalf)
  return [Math.floor(tu), Math.floor(tv)]
}

/**
 * Pointer-input adapter for the Texture-mode 2D canvas — the texel twin of `usePixelCanvasTools`.
 * Builds a fresh `TextureToolContext` each render (mirrored into a ref) and dispatches to
 * `textureToolMap[activeTool]`; owns the canvas's own pan/zoom camera (texel-scaled). Tool dispatch
 * is gated on an active box face being selected — until one is, only pan/zoom respond.
 */
export function useTextureCanvasTools(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const drag = useRef<TextureDragState>({ kind: 'idle' })
  const cloneSourceRef = useRef<[number, number] | null>(null)
  const cloneOffsetRef = useRef<[number, number] | null>(null)
  const panDragRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; hasMoved: boolean } | null>(null)

  // Multi-touch gesture tracking — the texel twin of usePixelCanvasTools' touch handling: every
  // active touch's last known client position, a pinch gesture's start reference (once a second
  // finger has landed), and a solo touch's pending hold-to-commit timer.
  const activeTouchesRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map())
  const pinchRef = useRef<{ startDist: number; anchorU: number; anchorV: number; startZoom: number } | null>(null)
  const touchHoldRef = useRef<{ pointerId: number; timer: ReturnType<typeof setTimeout> } | null>(null)

  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })
  const [pan, setPan] = useState<CanvasPan>({ x: 0, y: 0 })
  // Seed from the current project's extent so a face opens framed the same at any size (mirrors the
  // voxel canvas). The initializer reads the live store value to avoid a first-frame flash at zoom 1.
  const [zoom, setZoom] = useState(() => defaultTexZoomForExtent(useAppStore.getState().meta.gridExtent))
  const sizeRef = useRef(size)
  sizeRef.current = size
  const panRef = useRef(pan)
  panRef.current = pan
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const faceSize = faceSizeFor(gridExtent)
  const texHalf = faceSize / 2
  const texHalfRef = useRef(texHalf)
  texHalfRef.current = texHalf

  // Re-frame on a project switch to a different size: reset to the size-appropriate default zoom and
  // recenter. Extent is locked per project, so this only fires on switch, never mid-edit.
  useEffect(() => {
    setZoom(defaultTexZoomForExtent(gridExtent))
    setPan({ x: 0, y: 0 })
  }, [gridExtent])

  const [linePreview, setLinePreview] = useState<{ anchor: [number, number]; end: [number, number] } | null>(null)
  const [selectPreview, setSelectPreview] = useState<SelectionRegion | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const container = canvas.parentElement
    if (!container) return
    const update = () => {
      const rect = container.getBoundingClientRect()
      setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [canvasRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.pow(1.1, -e.deltaY / 15)
        const nextZoom = texClampZoom(zoomRef.current * factor)
        setZoom(nextZoom)
        setPan((p) => texClampPan(p, sizeRef.current, nextZoom, texHalfRef.current))
        return
      }
      if (e.deltaX !== 0) {
        const px = TEXEL_BASE_PX * zoomRef.current
        setPan((p) => texClampPan({ x: p.x + e.deltaX / px, y: p.y + e.deltaY / px }, sizeRef.current, zoomRef.current, texHalfRef.current))
        return
      }
      const factor = Math.pow(1.1, -e.deltaY / 100)
      const nextZoom = texClampZoom(zoomRef.current * factor)
      setZoom(nextZoom)
      setPan((p) => texClampPan(p, sizeRef.current, nextZoom, texHalfRef.current))
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [canvasRef])

  // Avoid a delayed tool commit firing after unmount (e.g. switching modes mid-tap).
  useEffect(() => {
    return () => {
      if (touchHoldRef.current) clearTimeout(touchHoldRef.current.timer)
    }
  }, [])

  const texture = useAppStore((s) => s.texture)
  const activeBoxFace = useAppStore((s) => s.activeBoxFace)
  const activeGrayIndex = useAppStore((s) => s.activeGrayIndex)
  const selection = useAppStore((s) => s.textureSelection)
  const floatContent = useAppStore((s) => s.textureFloat)
  const floatOrigin = useAppStore((s) => s.textureFloatOrigin)
  const clipboard = useAppStore((s) => s.textureClipboard)
  const activeTool = useAppStore((s) => s.activeTool)

  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const activeFaceRef = useRef(activeBoxFace)
  activeFaceRef.current = activeBoxFace

  const store = useAppStore.getState() // action references are stable for the store's lifetime

  const ctx: TextureToolContext = {
    texture, activeBoxFace, activeGrayIndex, faceSize, selection, floatContent, floatOrigin, clipboard,
    paintTexel: store.paintTexel,
    eraseTexel: store.eraseTexel,
    floodFillTexel: store.floodFillTexel,
    cloneStampTexel: store.cloneStampTexel,
    beginTextureMove: store.beginTextureMove,
    updateTextureMove: store.updateTextureMove,
    endTextureMove: store.endTextureMove,
    setActiveGrayIndex: store.setActiveGrayIndex,
    setActiveTool: store.setActiveTool,
    setSelection: store.setTextureSelection,
    liftToFloat: store.textureLiftToFloat,
    moveFloatTo: store.textureMoveFloatTo,
    bakeFloatIfAny: store.textureBakeFloatIfAny,
    beginStroke: store.textureBeginStroke,
    commitStroke: store.textureCommitStroke,
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

  // Ends whichever single-finger tool gesture is active for `pointerId` (if any) via that tool's
  // own onUp — as if the finger had simply been lifted — using its last known touch position. Safe
  // to call defensively (each handler no-ops without a matching drag in progress): the texel twin of
  // usePixelCanvasTools' `finishTouchDrag`.
  const finishTouchDrag = useCallback(
    (pointerId: number) => {
      const canvas = canvasRef.current
      const pos = activeTouchesRef.current.get(pointerId)
      if (!canvas || !pos) return
      const cell = pixelToTexel(canvas, pos.clientX, pos.clientY, sizeRef.current, panRef.current, zoomRef.current, texHalfRef.current)
      const normalized = toNormalizedPointerEvent(
        { button: 0, buttons: 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerId },
        cell,
      )
      textureToolMap[activeToolRef.current].onUp?.(ctxRef.current, normalized)
      canvas.releasePointerCapture(pointerId)
    },
    [canvasRef],
  )

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

      if (e.pointerType === 'touch') {
        canvas.setPointerCapture(e.pointerId)
        activeTouchesRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })

        if (activeTouchesRef.current.size >= 2) {
          // A second finger just landed — pinch/pan, not a tap or stroke. Cancel a still-pending
          // solo tap outright, or cleanly end one that already committed (as if that finger had
          // been lifted), before starting the gesture.
          const otherId = [...activeTouchesRef.current.keys()].find((id) => id !== e.pointerId)
          if (touchHoldRef.current && otherId !== undefined && touchHoldRef.current.pointerId === otherId) {
            clearTimeout(touchHoldRef.current.timer)
            touchHoldRef.current = null
          } else if (otherId !== undefined) {
            finishTouchDrag(otherId)
          }
          const rect = canvas.getBoundingClientRect()
          const pts = [...activeTouchesRef.current.values()].map((p) => ({ x: p.clientX - rect.left, y: p.clientY - rect.top }))
          const mid = touchMidpoint(pts[0], pts[1])
          const [anchorU, anchorV] = texScreenToWorld(mid.x, mid.y, size, pan, zoom, texHalf)
          pinchRef.current = { startDist: touchDistance(pts[0], pts[1]), anchorU, anchorV, startZoom: zoom }
          return
        }

        if (!activeFaceRef.current) return // nothing to draw — still tracked above for a possible pinch
        const cell = pixelToTexel(canvas, e.clientX, e.clientY, size, pan, zoom, texHalf)
        const normalized = toNormalizedPointerEvent(e, cell)
        touchHoldRef.current = {
          pointerId: e.pointerId,
          timer: setTimeout(() => {
            touchHoldRef.current = null
            textureToolMap[activeToolRef.current].onDown?.(ctxRef.current, normalized)
          }, TOUCH_GESTURE_DELAY_MS),
        }
        return
      }

      if (!activeFaceRef.current) return
      const cell = pixelToTexel(canvas, e.clientX, e.clientY, size, pan, zoom, texHalf)
      canvas.setPointerCapture(e.pointerId)
      textureToolMap[activeToolRef.current].onDown?.(ctxRef.current, toNormalizedPointerEvent(e, cell))
    },
    [canvasRef, size, pan, zoom, texHalf, finishTouchDrag],
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
        const px = TEXEL_BASE_PX * zoom
        setPan((p) => texClampPan({ x: p.x + dx / px, y: p.y + dy / px }, size, zoom, texHalf))
        return
      }

      if (e.pointerType === 'touch' && activeTouchesRef.current.has(e.pointerId)) {
        activeTouchesRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })

        if (pinchRef.current && activeTouchesRef.current.size >= 2) {
          const rect = canvas.getBoundingClientRect()
          const pts = [...activeTouchesRef.current.values()].map((p) => ({ x: p.clientX - rect.left, y: p.clientY - rect.top }))
          const mid = touchMidpoint(pts[0], pts[1])
          const dist = touchDistance(pts[0], pts[1])
          const { startDist, anchorU, anchorV, startZoom } = pinchRef.current
          const nextZoom = texClampZoom(startZoom * (dist / startDist))
          const pxNext = TEXEL_BASE_PX * nextZoom
          const nextPan = texClampPan(
            { x: (mid.x - size.width / 2) / pxNext - anchorU + texHalf, y: (mid.y - size.height / 2) / pxNext - anchorV + texHalf },
            size,
            nextZoom,
            texHalf,
          )
          setZoom(nextZoom)
          setPan(nextPan)
          return
        }

        // Still inside the solo-tap hold window — nothing to dispatch yet.
        if (touchHoldRef.current) return
      }

      if (!activeFaceRef.current) return
      const cell = pixelToTexel(canvas, e.clientX, e.clientY, size, pan, zoom, texHalf)
      textureToolMap[activeToolRef.current].onMove?.(ctxRef.current, toNormalizedPointerEvent(e, cell))
    },
    [canvasRef, size, pan, zoom, texHalf],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const panDrag = panDragRef.current
      if (panDrag) {
        panDragRef.current = null
        canvas.releasePointerCapture(e.pointerId)
        return
      }

      if (e.pointerType === 'touch') {
        activeTouchesRef.current.delete(e.pointerId)

        if (touchHoldRef.current?.pointerId === e.pointerId) {
          // Lifted before the hold window elapsed — a genuine quick tap, replayed as a synchronous
          // down+up so it isn't swallowed just for being fast.
          clearTimeout(touchHoldRef.current.timer)
          touchHoldRef.current = null
          canvas.releasePointerCapture(e.pointerId)
          if (!activeFaceRef.current) return
          const cell = pixelToTexel(canvas, e.clientX, e.clientY, size, pan, zoom, texHalf)
          const normalized = toNormalizedPointerEvent(e, cell)
          textureToolMap[activeToolRef.current].onDown?.(ctxRef.current, normalized)
          textureToolMap[activeToolRef.current].onUp?.(ctxRef.current, normalized)
          return
        }

        if (pinchRef.current) {
          canvas.releasePointerCapture(e.pointerId)
          if (activeTouchesRef.current.size < 2) pinchRef.current = null
          return
        }
        // Otherwise a solo touch's tool gesture is already active — fall through to the normal
        // onUp dispatch below, same as mouse/pen.
      }

      if (!activeFaceRef.current) return
      const cell = pixelToTexel(canvas, e.clientX, e.clientY, size, pan, zoom, texHalf)
      textureToolMap[activeToolRef.current].onUp?.(ctxRef.current, toNormalizedPointerEvent(e, cell))
      canvas.releasePointerCapture(e.pointerId)
    },
    [canvasRef, size, pan, zoom, texHalf],
  )

  return { onPointerDown, onPointerMove, onPointerUp, linePreview, selectPreview, size, pan, zoom }
}
