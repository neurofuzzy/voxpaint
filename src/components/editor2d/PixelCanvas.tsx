import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel, pixelFromGridCoord } from '@/engine/plane/constructionPlane'
import { displayViewCenter, toDisplayU, toDisplayV } from '@/engine/plane/planeDisplay'
import { resolveSlotColor, shadeColor } from '@/engine/palette/palette'
import { forEachSelectedCell, traceSelectionOutline } from '@/engine/tools/selectionMask'
import { encodeSliceKey } from '@/engine/animation/animationLayers'
import { useAppStore } from '@/store/useAppStore'
import { worldToScreen } from './cameraTransform'
import { BASE_CELL_PX } from './canvasConstants'
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

/**
 * Lightweight stipple fill for a screen-space rect: only every other pixel on both axes gets
 * painted (a 25%-density dot lattice), so it reads as a hint of fill rather than solid paint.
 * Dots align to an absolute canvas-pixel lattice (not cell-relative), so adjacent cells' patterns
 * connect seamlessly regardless of pan/zoom.
 */
function fillDither(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number, color: string) {
  ctx.fillStyle = color
  const endX = sx + size
  const endY = sy + size
  let startX = Math.ceil(sx)
  if (startX % 2 !== 0) startX++
  for (let px = startX; px < endX; px += 2) {
    let startY = Math.ceil(sy)
    if (startY % 2 !== 0) startY++
    for (let py = startY; py < endY; py += 2) {
      if ((px + py) % 4 == 0) continue;
      ctx.fillRect(px, py, 1, 1)
    }
  }
}

const CHAMFER_STRIPE_WIDTH = 4
const CHAMFER_SHADE_DELTA = 24

/**
 * 2px-wide 45° diagonal stripes alternating between a slightly darker and slightly lighter shade
 * of the voxel's own color — the active-plane marker for a chamfered cell, replacing a flat fill.
 * Only ever called for the active plane's own cells (see the draw loop below) — behind-layer
 * reference cells always use the flat dithered fill regardless of chamfer status.
 */
function fillDiagonalStripes(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number, color: string) {
  const colorA = color;
  const colorB = shadeColor(color, -CHAMFER_SHADE_DELTA)
  ctx.save()
  ctx.beginPath()
  ctx.rect(sx, sy, size, size)
  ctx.clip()
  ctx.translate(sx + size / 2, sy + size / 2)
  ctx.rotate(Math.PI / 4)
  const span = size * Math.SQRT2
  const half = span / 2
  let i = 0
  for (let x = -half; x < half; x += CHAMFER_STRIPE_WIDTH) {
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB
    ctx.fillRect(x, -half, CHAMFER_STRIPE_WIDTH, span)
    i++
  }
  ctx.restore()
}

export function PixelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const plane = useAppStore((s) => s.plane)
  const selection = useAppStore((s) => s.selection)
  const floatContent = useAppStore((s) => s.floatContent)
  const floatOrigin = useAppStore((s) => s.floatOrigin)
  const mode = useAppStore((s) => s.mode)
  const sliceMasks = useAppStore((s) => s.sliceMasks)
  const slicePivots = useAppStore((s) => s.slicePivots)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave, linePreview, selectPreview, hoverCellRef, size, pan, zoom } =
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
    // The 2D canvas is drawn in DISPLAY space (post-`toDisplay` mirror), so cropping an odd project
    // to its centred `n`-wide window is robust on every plane/orientation: we frame the window on the
    // centre pillar's *display* cell (`displayViewCenter`) rather than nudging a fixed pan, since the
    // pillar's display cell — and thus the half-cell offset that centres it — flips with orientation.
    // For even sizes the centre is the world-origin gridline and the window is symmetric (unchanged
    // behaviour). The model stays the even `effectiveExtent` grid; this is a pure view crop.
    const n = gridExtent
    const centre = displayViewCenter(plane, gridExtent)
    const dLoU = Math.floor(centre.u - n / 2)
    const dHiU = dLoU + n // exclusive cell bound; inclusive last gridline
    const dLoV = Math.floor(centre.v - n / 2)
    const dHiV = dLoV + n

    // checkerboard for empty cells, over the visible display window
    ctx.fillStyle = '#141416'
    for (let du = dLoU; du < dHiU; du++) {
      for (let dv = dLoV; dv < dHiV; dv++) {
        if ((du + dv) % 2 === 0) continue
        const [sx, sy] = worldToScreen(du, dv, size, pan, zoom)
        ctx.fillRect(sx, sy, cellPx, cellPx)
      }
    }

    // Grid lines — fine per-cell, bolder every 8 cells, and a lighter (toned-down, not stark)
    // centre accent, clipped to the grid's own screen-space bounds (not the full viewport, so
    // panned-out empty space beyond the working area stays plain). Mirrors trixelart's grid
    // visual hierarchy, adapted from its triangular lattice to a plain rectangular one. Drawn
    // before any content so painted cells, behind-layer outlines, and overlays all sit on top of
    // it instead of the grid cutting through them. Vertical (u) and horizontal (v) lines are drawn
    // separately since an odd window is not symmetric in the two axes.
    const [gridLeft] = worldToScreen(dLoU, 0, size, pan, zoom)
    const [gridRight] = worldToScreen(dHiU, 0, size, pan, zoom)
    const [, gridTop] = worldToScreen(0, dLoV, size, pan, zoom)
    const [, gridBottom] = worldToScreen(0, dHiV, size, pan, zoom)

    const strokeVLines = (positions: number[], color: string) => {
      if (positions.length === 0) return
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const i of positions) {
        const [sx] = worldToScreen(i, 0, size, pan, zoom)
        const snappedX = snapPx(sx)
        ctx.moveTo(snappedX, gridTop)
        ctx.lineTo(snappedX, gridBottom)
      }
      ctx.stroke()
    }
    const strokeHLines = (positions: number[], color: string) => {
      if (positions.length === 0) return
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const i of positions) {
        const [, sy] = worldToScreen(0, i, size, pan, zoom)
        const snappedY = snapPx(sy)
        ctx.moveTo(gridLeft, snappedY)
        ctx.lineTo(gridRight, snappedY)
      }
      ctx.stroke()
    }

    // Centre accent — a single axis line each way. For an even project it sits on the world-origin
    // gridline (display 0); for an odd project it runs through the *middle* of the centre pillar cell
    // (display `centre.u`/`centre.v`, a half-integer), so there's one axis crossing at the pillar's
    // centre rather than two lines bounding it. `snapPx` keeps the mid-cell line crisp.
    const centreU = n % 2 === 0 ? [0] : [centre.u]
    const centreV = n % 2 === 0 ? [0] : [centre.v]
    // The two integer cell edges bounding an odd centre pillar must render as plain fine lines, never
    // the brighter every-8 subdivision — otherwise the edge beside the mid-cell accent (e.g. display
    // 0, a multiple of 8) reads as a spurious second axis. Even sizes have nothing to demote: their
    // accent already sits on the grid at 0.
    const demoteU = n % 2 === 0 ? [] : [centre.u - 0.5, centre.u + 0.5]
    const demoteV = n % 2 === 0 ? [] : [centre.v - 0.5, centre.v + 0.5]
    const tiers = (from: number, to: number, accent: number[], demote: number[]) => {
      const fine: number[] = []
      const subdiv: number[] = []
      for (let i = from; i <= to; i++) {
        if (accent.includes(i)) continue // centre accent drawn separately, below
        if (i % 8 === 0 && !demote.includes(i)) subdiv.push(i)
        else fine.push(i)
      }
      return { fine, subdiv }
    }
    const uTiers = tiers(dLoU, dHiU, centreU, demoteU)
    const vTiers = tiers(dLoV, dHiV, centreV, demoteV)
    // Colors match the 3D construction plane's gridHelper tiers exactly (ConstructionPlaneVisual.tsx).
    strokeVLines(uTiers.fine, '#22303a')
    strokeHLines(vTiers.fine, '#22303a')
    strokeVLines(uTiers.subdiv, '#3d6d8a')
    strokeHLines(vTiers.subdiv, '#3d6d8a')
    strokeVLines(centreU, '#7ac8ff')
    strokeHLines(centreV, '#7ac8ff')

    // Architectural-drawing-style reference: the layer immediately behind the active plane (one
    // step further from the viewer along the plane's own normal — offset - orientation), shown as
    // a single-pixel outline plus a light dithered fill per voxel, in that voxel's own color.
    // Drawn before the active layer's own content so it reads as sitting "behind" it (any cell
    // painted on both layers at the same (u,v) has its behind-layer marks fully covered by the
    // active layer's opaque fill).
    const behindPlane = { ...plane, offset: plane.offset - plane.orientation }
    ctx.lineWidth = 2
    for (let du = dLoU; du < dHiU; du++) {
      for (let dv = dLoV; dv < dHiV; dv++) {
        const u = toDisplayU(plane, du)
        const v = toDisplayV(plane, dv)
        const behindCell = model.color.get(encodeKey(...gridCoordFromPixel(behindPlane, u, v)))
        if (!behindCell) continue
        const [sx, sy] = worldToScreen(du, dv, size, pan, zoom)
        const color = resolveSlotColor(palette, behindCell.paletteSlot)
        fillDither(ctx, sx, sy, cellPx, color)
        ctx.strokeStyle = color
        ctx.strokeRect(sx + 0.5, sy + 0.5, cellPx - 1, cellPx - 1)
      }
    }

    for (let du = dLoU; du < dHiU; du++) {
      for (let dv = dLoV; dv < dHiV; dv++) {
        const u = toDisplayU(plane, du)
        const v = toDisplayV(plane, dv)
        const coord = gridCoordFromPixel(plane, u, v)
        const key = encodeKey(...coord)
        const colorCell = model.color.get(key)
        if (!colorCell) continue
        const [sx, sy] = worldToScreen(du, dv, size, pan, zoom)
        const color = resolveSlotColor(palette, colorCell.paletteSlot)
        // Glass reads as 50% transparent here too, echoing the 3D view's transmissive material —
        // otherwise a glass cell looks identical to a solid one on the flat 2D canvas.
        ctx.globalAlpha = colorCell.paletteSlot.kind === 'glass' ? 0.5 : 1
        // Any chamfer cell shows the diagonal-stripe marker (whether or not its shape has resolved
        // yet), so it's always distinguishable from a plain cube; plain cubes get a flat fill.
        if (model.chamfer.has(key)) {
          fillDiagonalStripes(ctx, sx, sy, cellPx, color)
        } else {
          ctx.fillStyle = color
          ctx.fillRect(sx, sy, cellPx, cellPx)
        }
      }
    }
    ctx.globalAlpha = 1

    // Animate-mode mask overlay — violet tint over cells painted into the current slice's
    // animation mask (matches AnimationPalette's accent color). No overlay at all when the slice
    // has no mask painted, since that means "whole slice animates" (nothing to highlight).
    if (mode === 'animate') {
      const currentMask = sliceMasks.get(encodeSliceKey(plane.axis, plane.offset))
      if (currentMask && currentMask.size > 0) {
        for (let du = dLoU; du < dHiU; du++) {
          for (let dv = dLoV; dv < dHiV; dv++) {
            const u = toDisplayU(plane, du)
            const v = toDisplayV(plane, dv)
            const coord = gridCoordFromPixel(plane, u, v)
            const key = encodeKey(...coord)
            if (!currentMask.has(key)) continue
            const [sx, sy] = worldToScreen(du, dv, size, pan, zoom)
            ctx.fillStyle = 'rgba(167, 139, 250, 0.35)'
            ctx.fillRect(sx, sy, cellPx, cellPx)
            ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)'
            ctx.lineWidth = 1
            ctx.strokeRect(sx + 0.5, sy + 0.5, cellPx - 1, cellPx - 1)
          }
        }
      }
    }

    // Animate-mode pivot marker — a small violet dot at the current slice's rotation/pendulum
    // pivot cell, if one is set (matches PivotGizmo.tsx's 3D marker and the mask overlay's accent
    // color). The map is keyed by slice identity itself, so a hit here already means "on this slice".
    if (mode === 'animate') {
      const pivotKey = slicePivots.get(encodeSliceKey(plane.axis, plane.offset))
      if (pivotKey) {
        const { u: pu, v: pv } = pixelFromGridCoord(plane, decodeKey(pivotKey))
        const [px, py] = worldToScreen(toDisplayU(plane, pu) + 0.5, toDisplayV(plane, pv) + 0.5, size, pan, zoom)
        const radius = cellPx * 0.22
        ctx.beginPath()
        ctx.arc(px, py, radius, 0, Math.PI * 2)
        ctx.fillStyle = '#8b5cf6'
        ctx.fill()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    // paint-tool shift-line preview
    if (linePreview) {
      const [ax, ay] = worldToScreen(
        toDisplayU(plane, linePreview.anchor[0]) + 0.5,
        toDisplayV(plane, linePreview.anchor[1]) + 0.5,
        size,
        pan,
        zoom,
      )
      const [ex, ey] = worldToScreen(
        toDisplayU(plane, linePreview.end[0]) + 0.5,
        toDisplayV(plane, linePreview.end[1]) + 0.5,
        size,
        pan,
        zoom,
      )
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ex, ey)
      ctx.stroke()
    }

    // floating content — real, uncommitted cells rendered on top of the (already-hole-punched)
    // base grid (glass cells still get the 50% transparency treatment, same as committed cells).
    if (floatContent && floatOrigin) {
      for (const cell of floatContent.cells) {
        const u = floatOrigin.originU + cell.du
        const v = floatOrigin.originV + cell.dv
        const [sx, sy] = worldToScreen(toDisplayU(plane, u), toDisplayV(plane, v), size, pan, zoom)
        if (cell.color) {
          const color = resolveSlotColor(palette, cell.color.paletteSlot)
          ctx.globalAlpha = cell.color.paletteSlot.kind === 'glass' ? 0.5 : 1
          if (cell.chamfer) {
            fillDiagonalStripes(ctx, sx, sy, cellPx, color)
          } else {
            ctx.fillStyle = color
            ctx.fillRect(sx, sy, cellPx, cellPx)
          }
        }
      }
      ctx.globalAlpha = 1
    }

    // selection overlay — cyan tint + animated marching-ants outline (live drag preview takes
    // precedence over the committed selection).
    const activeRegion = selectPreview ?? selection
    if (activeRegion) {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.25)'
      forEachSelectedCell(activeRegion, (u, v) => {
        const [sx, sy] = worldToScreen(toDisplayU(plane, u), toDisplayV(plane, v), size, pan, zoom)
        ctx.fillRect(sx, sy, cellPx, cellPx)
      })

      ctx.strokeStyle = 'rgb(34, 211, 238)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 6])
      ctx.lineDashOffset = -antPhase
      for (const [[au, av], [bu, bv]] of traceSelectionOutline(activeRegion)) {
        const [ax, ay] = worldToScreen(toDisplayU(plane, au), toDisplayV(plane, av), size, pan, zoom)
        const [bx, by] = worldToScreen(toDisplayU(plane, bu), toDisplayV(plane, bv), size, pan, zoom)
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
  }, [model, palette, plane, linePreview, selection, selectPreview, floatContent, floatOrigin, antPhase, size, pan, zoom, mode, sliceMasks, slicePivots, gridExtent])

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
      onPointerLeave={onPointerLeave}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
