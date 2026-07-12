import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { forEachSelectedCell, traceSelectionOutline } from '@/engine/tools/selectionMask'
import { projectModelToFace } from '@/engine/texture/projection'
import { getTexel, texelIndex } from '@/engine/texture/TextureStore'
import { EMPTY, FACE_SIZE, GRAYSCALE } from '@/engine/texture/types'
import { useAppStore } from '@/store/useAppStore'
import { TEXEL_BASE_PX, texWorldToScreen } from './textureCanvasConstants'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useTextureCanvasTools } from './useTextureCanvasTools'

function snapPx(v: number): number {
  return Math.round(v - 0.5) + 0.5
}

/**
 * The Texture-mode 2D drawing surface: renders the active box face's `FACE_SIZE²` grayscale texel
 * grid and dispatches pointer input to the texture tools (`useTextureCanvasTools`). Structural twin
 * of `PixelCanvas`, but texel-native — no plane, no orientation mirroring, no chamfer marks. Until a
 * box face is selected (by clicking the model in the 3D view) it shows a prompt instead.
 */
export function TextureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const texture = useAppStore((s) => s.texture)
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const activeBoxFace = useAppStore((s) => s.activeBoxFace)
  const selection = useAppStore((s) => s.textureSelection)
  const floatContent = useAppStore((s) => s.textureFloat)
  const floatOrigin = useAppStore((s) => s.textureFloatOrigin)

  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const onionSkin = useAppStore((s) => s.onionSkin)
  const { onPointerDown, onPointerMove, onPointerUp, linePreview, selectPreview, size, pan, zoom } = useTextureCanvasTools(canvasRef)
  useKeyboardShortcuts()

  // Model silhouette projected onto the active face — a paint-alignment guide behind the texels.
  // Recomputed only when the model/palette/face changes (not while painting), so strokes stay fast.
  const projection = useMemo(
    () => (activeBoxFace ? projectModelToFace(model, palette, activeBoxFace) : null),
    [model, palette, activeBoxFace],
  )

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

    const px = TEXEL_BASE_PX * zoom
    const face = activeBoxFace

    // Face content — painted texels show their grayscale; unpainted texels reveal the model
    // silhouette projected onto this face, or a medium-gray checkerboard when onion skin is off.
    for (let tv = 0; tv < FACE_SIZE; tv++) {
      for (let tu = 0; tu < FACE_SIZE; tu++) {
        const value = face ? getTexel(texture, face, tu, tv) : EMPTY
        let fill: string | null = null
        if (value === EMPTY) {
          if (onionSkin && projection) {
            fill = projection[texelIndex(tu, tv)]
          }
        } else {
          fill = GRAYSCALE[value] ?? '#ff00ff'
        }
        if (!fill) {
          if (onionSkin) continue
          fill = (tu + tv) % 2 === 0 ? '#2f3840' : '#3d4852'
        }
        const [sx, sy] = texWorldToScreen(tu, tv, size, pan, zoom)
        ctx.fillStyle = fill
        ctx.fillRect(sx, sy, px + 1, px + 1)
      }
    }

    // Faint border framing the paintable face extent (no interior grid — the projection is the guide).
    const [left, top] = texWorldToScreen(0, 0, size, pan, zoom)
    const [right, bottom] = texWorldToScreen(FACE_SIZE, FACE_SIZE, size, pan, zoom)
    ctx.strokeStyle = '#2a3540'
    ctx.lineWidth = 1.5
    ctx.strokeRect(snapPx(left), snapPx(top), right - left, bottom - top)

    // paint-tool shift-line preview
    if (linePreview) {
      const [ax, ay] = texWorldToScreen(linePreview.anchor[0] + 0.5, linePreview.anchor[1] + 0.5, size, pan, zoom)
      const [ex, ey] = texWorldToScreen(linePreview.end[0] + 0.5, linePreview.end[1] + 0.5, size, pan, zoom)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ex, ey)
      ctx.stroke()
    }

    // floating texel content (pending move/paste) rendered opaque on top.
    if (floatContent && floatOrigin) {
      for (let dv = 0; dv < floatContent.height; dv++) {
        for (let du = 0; du < floatContent.width; du++) {
          const value = floatContent.cells[dv * floatContent.width + du]
          if (value === EMPTY) continue
          const [sx, sy] = texWorldToScreen(floatOrigin.originU + du, floatOrigin.originV + dv, size, pan, zoom)
          ctx.fillStyle = GRAYSCALE[value] ?? '#ff00ff'
          ctx.fillRect(sx, sy, px + 1, px + 1)
        }
      }
    }

    // selection overlay — cyan tint + animated marching ants.
    const activeRegion = selectPreview ?? selection
    if (activeRegion) {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.25)'
      forEachSelectedCell(activeRegion, (u, v) => {
        const [sx, sy] = texWorldToScreen(u, v, size, pan, zoom)
        ctx.fillRect(sx, sy, px + 1, px + 1)
      })
      ctx.strokeStyle = 'rgb(34, 211, 238)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 6])
      ctx.lineDashOffset = -antPhase
      for (const [[au, av], [bu, bv]] of traceSelectionOutline(activeRegion)) {
        const [ax, ay] = texWorldToScreen(au, av, size, pan, zoom)
        const [bx, by] = texWorldToScreen(bu, bv, size, pan, zoom)
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
  }, [texture, activeBoxFace, projection, onionSkin, linePreview, selection, selectPreview, floatContent, floatOrigin, antPhase, size, pan, zoom])

  useEffect(() => {
    draw()
  }, [draw])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setStatusMessage(null)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!activeBoxFace && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-md bg-neutral-900/80 px-4 py-2 text-sm text-neutral-300 shadow-lg ring-1 ring-neutral-700">
            Click a face of the model to paint its texture
          </p>
        </div>
      )}
    </>
  )
}
