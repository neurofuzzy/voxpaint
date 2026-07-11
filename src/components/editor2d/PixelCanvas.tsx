import { useCallback, useEffect, useRef, useState } from 'react'
import { encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { resolveSlotColor } from '@/engine/palette/palette'
import { forEachSelectedCell, traceSelectionOutline } from '@/engine/tools/selectionMask'
import { useAppStore } from '@/store/useAppStore'
import { worldToScreen } from './cameraTransform'
import { BASE_CELL_PX, HALF } from './canvasConstants'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { usePixelCanvasTools } from './usePixelCanvasTools'

/**
 * Snaps a coordinate to the center of the nearest physical pixel row/column, so a `lineWidth: 1`
 * stroke at that position renders crisp rather than anti-aliased across two rows — continuous
 * pan/zoom otherwise puts line coordinates at arbitrary fractional positions, which is what makes
 * canvas grid lines look blurry/soft (not a CSS up-scaling issue — the canvas's backing bitmap is
 * already DPR-matched to its CSS size; this is purely about *where* a thin line's own coordinate
 * falls within a pixel).
 */
function snapPx(v: number): number {
  return Math.round(v - 0.5) + 0.5
}

export function PixelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const plane = useAppStore((s) => s.plane)
  const selection = useAppStore((s) => s.selection)
  const floatContent = useAppStore((s) => s.floatContent)
  const floatOrigin = useAppStore((s) => s.floatOrigin)

  const { onPointerDown, onPointerMove, onPointerUp, linePreview, selectPreview, hoverCellRef, size, pan, zoom } =
    usePixelCanvasTools(canvasRef)
  useKeyboardShortcuts(hoverCellRef)

  // Marching-ants animation tick. Stops entirely (no rAF loop) when nothing is selected.
  const [antPhase, setAntPhase] = useState(0)
  useEffect(() => {
    const activeRegion = selectPreview ?? selection
    if (!activeRegion) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      setAntPhase(((now - start) / 1000) * 24)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [selection, selectPreview])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || size.height === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false

    ctx.fillStyle = '#0a0a0c'
    ctx.fillRect(0, 0, size.width, size.height)

    const cellPx = BASE_CELL_PX * zoom

    // checkerboard for empty cells, over the logical -HALF..HALF working span
    ctx.fillStyle = '#141416'
    for (let u = -HALF; u < HALF; u++) {
      for (let v = -HALF; v < HALF; v++) {
        if ((u + v) % 2 === 0) continue
        const [sx, sy] = worldToScreen(u, v, size, pan, zoom)
        ctx.fillRect(sx, sy, cellPx, cellPx)
      }
    }

    for (let u = -HALF; u < HALF; u++) {
      for (let v = -HALF; v < HALF; v++) {
        const coord = gridCoordFromPixel(plane, u, v)
        const key = encodeKey(...coord)
        const colorCell = model.color.get(key)
        if (!colorCell) continue
        const [sx, sy] = worldToScreen(u, v, size, pan, zoom)
        ctx.fillStyle = resolveSlotColor(palette, colorCell.paletteSlot)
        ctx.fillRect(sx, sy, cellPx, cellPx)

        if (model.chamfer.has(key)) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(sx, sy + cellPx)
          ctx.lineTo(sx + cellPx, sy)
          ctx.stroke()
        }
      }
    }

    // Grid lines — fine per-cell, bolder every 8 cells, and a lighter (toned-down, not stark)
    // origin crosshair, clipped to the grid's own screen-space bounds (not the full viewport, so
    // panned-out empty space beyond the working area stays plain). Mirrors trixelart's grid
    // visual hierarchy, adapted from its triangular lattice to a plain rectangular one.
    const [gridLeft] = worldToScreen(-HALF, 0, size, pan, zoom)
    const [gridRight] = worldToScreen(HALF, 0, size, pan, zoom)
    const [, gridTop] = worldToScreen(0, -HALF, size, pan, zoom)
    const [, gridBottom] = worldToScreen(0, HALF, size, pan, zoom)

    const strokeGridLines = (positions: number[], color: string) => {
      if (positions.length === 0) return
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const i of positions) {
        const [sx] = worldToScreen(i, 0, size, pan, zoom)
        const snappedX = snapPx(sx)
        ctx.moveTo(snappedX, gridTop)
        ctx.lineTo(snappedX, gridBottom)
        const [, sy] = worldToScreen(0, i, size, pan, zoom)
        const snappedY = snapPx(sy)
        ctx.moveTo(gridLeft, snappedY)
        ctx.lineTo(gridRight, snappedY)
      }
      ctx.stroke()
    }

    const fineLines: number[] = []
    const subdivLines: number[] = []
    for (let i = -HALF; i <= HALF; i++) {
      if (i === 0) continue // origin drawn separately, below
      if (i % 8 === 0) subdivLines.push(i)
      else fineLines.push(i)
    }
    // Colors match the 3D construction plane's gridHelper tiers exactly (ConstructionPlaneVisual.tsx).
    strokeGridLines(fineLines, '#22303a')
    strokeGridLines(subdivLines, '#3d6d8a')
    strokeGridLines([0], '#7ac8ff')

    // paint-tool shift-line preview
    if (linePreview) {
      const [ax, ay] = worldToScreen(linePreview.anchor[0] + 0.5, linePreview.anchor[1] + 0.5, size, pan, zoom)
      const [ex, ey] = worldToScreen(linePreview.end[0] + 0.5, linePreview.end[1] + 0.5, size, pan, zoom)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ex, ey)
      ctx.stroke()
    }

    // floating content — real, uncommitted cells rendered fully opaque on top of the (already-
    // hole-punched) base grid.
    if (floatContent && floatOrigin) {
      for (const cell of floatContent.cells) {
        const u = floatOrigin.originU + cell.du
        const v = floatOrigin.originV + cell.dv
        const [sx, sy] = worldToScreen(u, v, size, pan, zoom)
        if (cell.color) {
          ctx.fillStyle = resolveSlotColor(palette, cell.color.paletteSlot)
          ctx.fillRect(sx, sy, cellPx, cellPx)
        }
        if (cell.chamfer) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(sx, sy + cellPx)
          ctx.lineTo(sx + cellPx, sy)
          ctx.stroke()
        }
      }
    }

    // selection overlay — cyan tint + animated marching-ants outline (live drag preview takes
    // precedence over the committed selection).
    const activeRegion = selectPreview ?? selection
    if (activeRegion) {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.25)'
      forEachSelectedCell(activeRegion, (u, v) => {
        const [sx, sy] = worldToScreen(u, v, size, pan, zoom)
        ctx.fillRect(sx, sy, cellPx, cellPx)
      })

      ctx.strokeStyle = 'rgb(34, 211, 238)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 6])
      ctx.lineDashOffset = -antPhase
      for (const [[au, av], [bu, bv]] of traceSelectionOutline(activeRegion)) {
        const [ax, ay] = worldToScreen(au, av, size, pan, zoom)
        const [bx, by] = worldToScreen(bu, bv, size, pan, zoom)
        // Every outline edge is axis-aligned (traceSelectionOutline only emits unit cell edges),
        // so snap the shared coordinate for the same crisp-line reason as the grid.
        ctx.beginPath()
        if (ax === bx) {
          const sx = snapPx(ax)
          ctx.moveTo(sx, ay)
          ctx.lineTo(sx, by)
        } else {
          const sy = snapPx(ay)
          ctx.moveTo(ax, sy)
          ctx.lineTo(bx, sy)
        }
        ctx.stroke()
      }
      ctx.setLineDash([])
    }
  }, [model, palette, plane, linePreview, selection, selectPreview, floatContent, floatOrigin, antPhase, size, pan, zoom])

  useEffect(() => {
    draw()
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full cursor-crosshair touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
