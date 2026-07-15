import { useCallback, useEffect, useRef, useState } from 'react'
import { toNormalizedPointerEvent } from '@/engine/input/PointerInputController'
import { textureToolMap } from '@/engine/texture/textureTools'
import type { TextureToolContext, TextureDragState } from '@/engine/texture/textureTools'
import { faceSizeFor } from '@/engine/texture/types'
import { useAppStore } from '@/store/useAppStore'
import type { SelectionRegion } from '@/store/types'
import type { CanvasPan, CanvasSize } from './cameraTransform'
import { TEXEL_BASE_PX, texClampPan, texClampZoom, texScreenToWorld } from './textureCanvasConstants'

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

  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })
  const [pan, setPan] = useState<CanvasPan>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const sizeRef = useRef(size)
  sizeRef.current = size
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const faceSize = faceSizeFor(gridExtent)
  const texHalf = faceSize / 2
  const texHalfRef = useRef(texHalf)
  texHalfRef.current = texHalf

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
      if (!activeFaceRef.current) return
      const cell = pixelToTexel(canvas, e.clientX, e.clientY, size, pan, zoom, texHalf)
      canvas.setPointerCapture(e.pointerId)
      textureToolMap[activeToolRef.current].onDown?.(ctxRef.current, toNormalizedPointerEvent(e, cell))
    },
    [canvasRef, size, pan, zoom, texHalf],
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
      if (!activeFaceRef.current) return
      const cell = pixelToTexel(canvas, e.clientX, e.clientY, size, pan, zoom, texHalf)
      textureToolMap[activeToolRef.current].onUp?.(ctxRef.current, toNormalizedPointerEvent(e, cell))
      canvas.releasePointerCapture(e.pointerId)
    },
    [canvasRef, size, pan, zoom, texHalf],
  )

  return { onPointerDown, onPointerMove, onPointerUp, linePreview, selectPreview, size, pan, zoom }
}
