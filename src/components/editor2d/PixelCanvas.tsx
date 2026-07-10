import { useCallback, useEffect, useRef, useState } from 'react'
import { encodeKey } from '@/engine/grid/GridStore'
import { MAX_GRID_EXTENT } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { resolveSlotColor } from '@/engine/palette/palette'
import { bresenhamLine, snapToOrtho } from '@/engine/tools/lineUtils'
import { useAppStore } from '@/store/useAppStore'

const CELL_PX = 12
const GRID_SPAN = MAX_GRID_EXTENT // cells shown across, centered on 0,0
const HALF = GRID_SPAN / 2

export function PixelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isPaintingRef = useRef(false)
  const lastCellRef = useRef<[number, number] | null>(null)
  const anchorRef = useRef<[number, number] | null>(null)
  const [previewEnd, setPreviewEnd] = useState<[number, number] | null>(null)

  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const plane = useAppStore((s) => s.plane)
  const activeTool = useAppStore((s) => s.activeTool)
  const activeLayer = useAppStore((s) => s.activeLayer)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#0a0a0c'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // checkerboard for empty cells
    ctx.fillStyle = '#141416'
    for (let gu = 0; gu < GRID_SPAN; gu++) {
      for (let gv = 0; gv < GRID_SPAN; gv++) {
        if ((gu + gv) % 2 === 0) continue
        ctx.fillRect(gu * CELL_PX, gv * CELL_PX, CELL_PX, CELL_PX)
      }
    }

    for (let gu = 0; gu < GRID_SPAN; gu++) {
      const u = gu - HALF
      for (let gv = 0; gv < GRID_SPAN; gv++) {
        const v = gv - HALF
        const coord = gridCoordFromPixel(plane, u, v)
        const key = encodeKey(...coord)
        const colorCell = model.color.get(key)
        if (!colorCell) continue
        ctx.fillStyle = resolveSlotColor(palette, colorCell.paletteSlot)
        ctx.fillRect(gu * CELL_PX, gv * CELL_PX, CELL_PX, CELL_PX)

        if (model.chamfer.has(key)) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(gu * CELL_PX, gv * CELL_PX + CELL_PX)
          ctx.lineTo(gu * CELL_PX + CELL_PX, gv * CELL_PX)
          ctx.stroke()
        }
      }
    }

    // origin crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(HALF * CELL_PX, 0)
    ctx.lineTo(HALF * CELL_PX, GRID_SPAN * CELL_PX)
    ctx.moveTo(0, HALF * CELL_PX)
    ctx.lineTo(GRID_SPAN * CELL_PX, HALF * CELL_PX)
    ctx.stroke()

    if (previewEnd && anchorRef.current) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo((anchorRef.current[0] + HALF) * CELL_PX + CELL_PX / 2, (anchorRef.current[1] + HALF) * CELL_PX + CELL_PX / 2)
      ctx.lineTo((previewEnd[0] + HALF) * CELL_PX + CELL_PX / 2, (previewEnd[1] + HALF) * CELL_PX + CELL_PX / 2)
      ctx.stroke()
    }
  }, [model, palette, plane, previewEnd])

  useEffect(() => {
    draw()
  }, [draw])

  function pixelToCell(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    return [Math.floor(x / CELL_PX) - HALF, Math.floor(y / CELL_PX) - HALF]
  }

  function paintAt(u: number, v: number, erase: boolean) {
    const { paintColorCell, paintChamferCell, eraseCell } = useAppStore.getState()
    if (erase) {
      const coord = gridCoordFromPixel(plane, u, v)
      eraseCell(coord, activeLayer)
      return
    }
    if (activeLayer === 'chamfer') {
      paintChamferCell(u, v)
    } else {
      const coord = gridCoordFromPixel(plane, u, v)
      paintColorCell(coord)
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const [u, v] = pixelToCell(e)
    const erase = e.button === 2

    if (activeTool === 'eyedropper') {
      const coord = gridCoordFromPixel(plane, u, v)
      const cell = model.color.get(encodeKey(...coord))
      if (cell) useAppStore.getState().setActivePaletteSlot(cell.paletteSlot)
      return
    }
    if (activeTool !== 'paint') return

    canvasRef.current?.setPointerCapture(e.pointerId)
    isPaintingRef.current = true
    anchorRef.current = [u, v]
    lastCellRef.current = [u, v]

    if (e.shiftKey) {
      setPreviewEnd([u, v])
      return
    }
    void paintAt(u, v, erase)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isPaintingRef.current) return
    const [u, v] = pixelToCell(e)

    if (e.shiftKey && anchorRef.current) {
      const [su, sv] = snapToOrtho(anchorRef.current[0], anchorRef.current[1], u, v)
      setPreviewEnd([su, sv])
      return
    }

    const last = lastCellRef.current
    if (last && last[0] === u && last[1] === v) return
    const erase = e.buttons === 2
    if (last) {
      for (const [lu, lv] of bresenhamLine(last[0], last[1], u, v)) paintAt(lu, lv, erase)
    } else {
      paintAt(u, v, erase)
    }
    lastCellRef.current = [u, v]
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isPaintingRef.current) return
    isPaintingRef.current = false
    canvasRef.current?.releasePointerCapture(e.pointerId)

    if (previewEnd && anchorRef.current) {
      const erase = e.button === 2
      for (const [lu, lv] of bresenhamLine(anchorRef.current[0], anchorRef.current[1], previewEnd[0], previewEnd[1])) {
        paintAt(lu, lv, erase)
      }
    }
    setPreviewEnd(null)
    anchorRef.current = null
    lastCellRef.current = null
    useAppStore.getState().commitStroke()
  }

  function handlePointerDownCapture() {
    useAppStore.getState().beginStroke()
  }

  return (
    <canvas
      ref={canvasRef}
      width={GRID_SPAN * CELL_PX}
      height={GRID_SPAN * CELL_PX}
      className="cursor-crosshair touch-none"
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
