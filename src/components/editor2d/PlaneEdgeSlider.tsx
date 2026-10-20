import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FlipHorizontal, Lock, LockOpen } from 'lucide-react'
import { effectiveExtent } from '@/engine/grid/GridStore'
import type { Axis } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'

/** Finger travel per construction-plane layer — ~40 layers fit in a full-height iPad drag. */
const PX_PER_LAYER = 20

const AXES: Axis[] = ['x', 'y', 'z']

/** Round translucent button shared by the plane cluster (matches the steppers below). */
const ROUND_BTN =
  'flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700/60 ' +
  'bg-neutral-900/40 text-neutral-300 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ' +
  'enabled:hover:border-neutral-500 enabled:hover:bg-neutral-900/70 enabled:hover:text-neutral-100'

/**
 * Touch strip pinned to the far right edge of the window (over the 3D viewport's right edge —
 * it lives in MainLayout, not Editor2D): slide a finger up/down to step the
 * construction-plane offset (up = +1, down = −1), the touch equivalent of Shift+wheel.
 * Pointer-capture drag accumulates travel into whole layers, so slow drags are
 * precise and long drags traverse the whole working cube in one gesture. Keyboard-focusable
 * (Up/Down arrows) for the same reason.
 *
 * This strip carries no readout of its own except a transient bubble while dragging. Narrow and
 * translucent so it costs almost no canvas space; it sits under the 3D view's top-right and
 * bottom-right overlays (z-30 vs z-40) so those buttons stay tappable where they overlap.
 * Stepper buttons directly above (+1) and below (−1) the grip replace the old 2D overlay
 * steppers; the whole cluster is vertically centered, clear of the corner overlays.
 * Plane axis (cycle) and orientation (flip) buttons sit above the steppers, so the full
 * plane pose is driven from this one cluster. In 3D-only model mode a lock toggle sits above
 * the axis button: locked, 3D paint replaces the voxel on the active slice; unlocked, it
 * stacks in front of the clicked face (Zanpo-style).
 */
export function PlaneEdgeSlider() {
  const offset = useAppStore((s) => s.plane.offset)
  const planeAxis = useAppStore((s) => s.plane.axis)
  const planeOrientation = useAppStore((s) => s.plane.orientation)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const mode = useAppStore((s) => s.mode)
  const layoutMode = useAppStore((s) => s.layoutMode)
  const planeLocked3D = useAppStore((s) => s.planeLocked3D)
  const setPlaneLocked3D = useAppStore((s) => s.setPlaneLocked3D)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const [dragging, setDragging] = useState(false)
  // Drag anchor: the touch point and plane offset the gesture started from. Steps accumulate
  // from the anchor (not incrementally) so each layer boundary is crossed exactly once.
  const dragRef = useRef<{ startY: number; startOffset: number } | null>(null)

  const half = effectiveExtent(gridExtent) / 2
  const atTop = offset >= half - 1
  const atBottom = offset <= -half

  function stepFrom(clientY: number) {
    const anchor = dragRef.current
    if (!anchor) return
    const steps = Math.round((anchor.startY - clientY) / PX_PER_LAYER)
    const { plane, setPlaneOffset } = useAppStore.getState()
    const next = anchor.startOffset + steps
    // setPlaneOffset clamps to the project bounds; guard the call itself so hovering between
    // layer boundaries doesn't churn the store (each call bakes floats / clears object targets).
    if (next !== plane.offset) setPlaneOffset(next)
  }

  function stepperButton(
    direction: 1 | -1,
    label: string,
    hint: string,
    disabled: boolean,
    Icon: typeof ChevronUp,
  ) {
    return (
      <button
        aria-label={label}
        title={label}
        disabled={disabled}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => useAppStore.getState().setPlaneOffset(offset + direction)}
        onPointerEnter={() => setStatusMessage(hint)}
        onPointerLeave={() => setStatusMessage(null)}
        className={ROUND_BTN}
      >
        <Icon size={17} />
      </button>
    )
  }

  function planeButton(
    label: string,
    title: string,
    hint: string,
    onClick: () => void,
    children: React.ReactNode,
  ) {
    // onPointerDown stops propagation so pressing these never starts an offset drag.
    return (
      <button
        aria-label={label}
        title={title}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClick}
        onPointerEnter={() => setStatusMessage(hint)}
        onPointerLeave={() => setStatusMessage(null)}
        className={`${ROUND_BTN} font-mono text-sm font-semibold uppercase`}
      >
        {children}
      </button>
    )
  }

  const cycleAxis = () => {
    const { plane, setPlaneAxisOrientation } = useAppStore.getState()
    setPlaneAxisOrientation(AXES[(AXES.indexOf(plane.axis) + 1) % 3], plane.orientation)
  }
  const flipOrientation = () => {
    const { plane, setPlaneAxisOrientation } = useAppStore.getState()
    setPlaneAxisOrientation(plane.axis, plane.orientation === 1 ? -1 : 1)
  }
  // The plane lock only constrains 3D paint, which only exists in 3D-only model mode.
  const showLock = mode === 'model' && layoutMode === '3d-only'

  return (
    <div
      role="slider"
      aria-label="Construction plane offset"
      aria-valuenow={offset}
      aria-valuemin={-half}
      aria-valuemax={half - 1}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          useAppStore.getState().setPlaneOffset(offset + (e.key === 'ArrowUp' ? 1 : -1))
          e.preventDefault()
        }
      }}
      onPointerDown={(e) => {
        // Mouse drags work too (harmless on desktop); the primary target is touch.
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { startY: e.clientY, startOffset: useAppStore.getState().plane.offset }
        setDragging(true)
        setStatusMessage('Slide up/down to move the construction plane')
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return
        e.preventDefault()
        stepFrom(e.clientY)
      }}
      onPointerUp={(e) => {
        dragRef.current = null
        setDragging(false)
        setStatusMessage(null)
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          // Already released (touch pointer-up auto-releases) — nothing to do.
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null
        setDragging(false)
        setStatusMessage(null)
      }}
      onPointerEnter={() => {
        if (!dragRef.current) setStatusMessage('Slide up/down on this edge to move the construction plane')
      }}
      onPointerLeave={() => {
        if (!dragRef.current) setStatusMessage(null)
      }}
      className="absolute bottom-0 right-0 top-0 z-30 flex w-12 touch-none select-none flex-col items-center justify-center outline-none"
    >
      <div className="flex flex-col items-center gap-2">
        {showLock && (
          <>
            <button
              aria-label={planeLocked3D ? 'Unlock construction plane' : 'Lock construction plane'}
              aria-pressed={planeLocked3D}
              title={planeLocked3D ? 'Unlock construction plane (paint stacks off faces)' : 'Lock construction plane (paint replaces on-slice)'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setPlaneLocked3D(!planeLocked3D)}
              onPointerEnter={() => setStatusMessage(planeLocked3D
                ? 'Plane locked: paint clicks replace the voxel on the active slice'
                : 'Plane unlocked: paint clicks stack a voxel in front of the face (Zanpo-style)')}
              onPointerLeave={() => setStatusMessage(null)}
              className={
                'flex h-9 w-9 items-center justify-center rounded-full border transition-colors ' +
                (planeLocked3D
                  ? 'border-violet-500/70 bg-violet-500/15 text-violet-300 hover:border-violet-400 hover:text-violet-200'
                  : 'border-neutral-700/60 bg-neutral-900/40 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-900/70 hover:text-neutral-100')
              }
            >
              {planeLocked3D ? <Lock size={16} /> : <LockOpen size={16} />}
            </button>
            <div className="h-px w-6 bg-neutral-700/60" />
          </>
        )}
        {planeButton(
          'Construction plane axis',
          'Construction plane axis (click to cycle)',
          'Click to cycle the construction plane axis',
          cycleAxis,
          planeAxis,
        )}
        {planeButton(
          'Flip plane orientation',
          `Flip plane orientation (currently ${planeOrientation === 1 ? '+' : '−'})`,
          'Click to flip the construction plane orientation',
          flipOrientation,
          <FlipHorizontal size={16} />,
        )}
        <div className="h-px w-6 bg-neutral-700/60" />
        {stepperButton(1, 'Increase offset', 'Click to move the plane forward one layer', atTop, ChevronUp)}
        {/* Grip hint — translucent until hovered/dragged so it reads as chrome, not canvas. */}
        <div
          className={
            'pointer-events-none flex w-9 flex-col items-center gap-1 ' +
            'rounded-full border px-2 py-3 transition-colors ' +
            (dragging
              ? 'border-cyan-400/70 bg-cyan-400/15'
              : 'border-neutral-700/60 bg-neutral-900/40 hover:border-neutral-500 hover:bg-neutral-900/70')
          }
        >
          <div className={`h-6 w-1 rounded-full ${atTop && !dragging ? 'bg-neutral-700' : 'bg-neutral-400'}`} />
          <div className="flex flex-col items-center gap-1">
            <div className="h-1 w-1 rounded-full bg-neutral-500" />
            <div className="h-1 w-1 rounded-full bg-neutral-500" />
            <div className="h-1 w-1 rounded-full bg-neutral-500" />
          </div>
          <div className={`h-6 w-1 rounded-full ${atBottom && !dragging ? 'bg-neutral-700' : 'bg-neutral-400'}`} />
        </div>
        {stepperButton(-1, 'Decrease offset', 'Click to move the plane back one layer', atBottom, ChevronDown)}
      </div>
      {dragging && (
        <div className="pointer-events-none absolute right-14 top-1/2 -translate-y-1/2 rounded-lg border border-cyan-400/50 bg-neutral-900/95 px-2.5 py-1.5 font-mono text-sm tabular-nums text-cyan-200 shadow-2xl">
          {offset}
        </div>
      )}
    </div>
  )
}
