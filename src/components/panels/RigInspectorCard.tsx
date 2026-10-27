import { useEffect, useState } from 'react'
import { ArrowLeftRight, Ban, Bone, Crosshair, RotateCcw, RotateCw } from 'lucide-react'
import type { Axis } from '@/engine/grid/types'
import { rigPivotOf, type RigBox, type RigLoop } from '@/engine/rigging/types'
import type { AnimationSpeed } from '@/engine/animation/types'
import { SLIDE_AMOUNT_MAX, SLIDE_AMOUNT_MIN } from '@/engine/animation/animationLayers'
import { defaultRigLoop, isLoopActive } from '@/engine/rigging/rigLoop'
import { useAppStore } from '@/store/useAppStore'
import type { PaletteOrientation } from './FloatingPalette'

/**
 * Animate-mode floating panel content: an inspector for the selected rig box (the mode's
 * primary object). Shows identity (name, dims), rotation center (with reset), looping
 * motion (rotate/slide cycles, mutually exclusive with posing), and outline position
 * (parent/children) — everything else lives in the outline, toolbar, and viewport.
 * Slice-loop authoring used to live here (`AnimationPalette`, deleted); slice loops from old
 * files still play back, they just can't be authored anymore.
 */
export function RigInspectorCard({ orientation = 'horizontal' }: { orientation?: PaletteOrientation } = {}) {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const renameRigBox = useAppStore((s) => s.renameRigBox)
  const setRigPivot = useAppStore((s) => s.setRigPivot)
  const setRigLoop = useAppStore((s) => s.setRigLoop)
  const poseCount = useAppStore((s) => s.poseRotations.size)
  const resetPose = useAppStore((s) => s.resetPose)
  const vertical = orientation === 'vertical'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const box = rigBoxes.find((b) => b.id === selectedRigBoxId) ?? null

  // A pending rename belongs to its box — selecting elsewhere discards it.
  useEffect(() => {
    setEditing(false)
    setDraft('')
  }, [selectedRigBoxId])

  function commitRename() {
    if (box && draft.trim()) renameRigBox(box.id, draft)
    setEditing(false)
    setDraft('')
  }

  return (
    <div
      className={'flex gap-2 ' + (vertical ? 'w-full flex-col items-stretch' : 'min-w-0 items-center')}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      {!box ? (
        <div className={'flex items-center gap-2 text-neutral-500 ' + (vertical ? '' : 'px-1')}>
          <Bone size={16} className="shrink-0" />
          <div className={vertical ? '' : 'whitespace-nowrap'}>
            <p className="text-[11px] font-medium text-neutral-300">
              {rigBoxes.length === 0 ? 'No rig boxes yet' : 'No box selected'}
            </p>
            <p className="text-[10px]">pick it in the outline or tap its footprint in 2D</p>
          </div>
        </div>
      ) : (
        <>
          <div className={'flex min-w-0 items-center gap-2 ' + (vertical ? '' : 'max-w-44')}>
            <Bone size={16} className="shrink-0 text-violet-400" />
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') { setEditing(false); setDraft('') }
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] font-semibold text-neutral-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            ) : (
              <button
                onDoubleClick={() => { setEditing(true); setDraft(box.name) }}
                title="Double-click to rename"
                className="min-w-0 flex-1 truncate text-left text-[11px] font-semibold text-neutral-100"
              >
                {box.name}
              </button>
            )}
            <span className="shrink-0 font-mono text-[10px] text-neutral-500">
              {box.max[0] - box.min[0] + 1}×{box.max[1] - box.min[1] + 1}×{box.max[2] - box.min[2] + 1}
            </span>
          </div>
          <div className={'flex items-center gap-1.5 ' + (vertical ? '' : 'border-l border-neutral-800 pl-2')}>
            {(() => {
              const pivot = rigPivotOf(box)
              const custom = box.pivot !== null
              return (
                <>
                  <span className="whitespace-nowrap font-mono text-[10px] text-neutral-400" title={custom ? 'Rotation-center override (half-integers sit on cell boundaries — rotate the plane to place depth)' : 'Rotates about the box center'}>
                    {custom ? `(${pivot[0]}, ${pivot[1]}, ${pivot[2]})` : 'center'}
                  </span>
                  <button
                    onClick={() => custom && setRigPivot(box.id, null)}
                    disabled={!custom}
                    title={custom ? 'Reset rotation center to box center' : 'Rotation center is the box center — click with the Pivot tool to move it'}
                    className={
                      'flex h-5 w-5 items-center justify-center rounded ' +
                      (custom ? 'text-violet-400 hover:bg-neutral-800 hover:text-violet-200' : 'cursor-default text-neutral-700')
                    }
                  >
                    <Crosshair size={12} />
                  </button>
                </>
              )
            })()}
          </div>
          <div className={'text-[10px] text-neutral-500 ' + (vertical ? '' : 'whitespace-nowrap border-l border-neutral-800 pl-2')}>
            {(() => {
              const kids = rigBoxes.filter((b) => b.parentId === box.id).length
              const parent = box.parentId ? rigBoxes.find((b) => b.id === box.parentId)?.name : null
              const parts = [kids === 1 ? '1 child' : `${kids} children`]
              if (parent) parts.unshift(`in ${parent}`)
              return parts.join(' · ')
            })()}
          </div>
          <LoopControls box={box} setRigLoop={setRigLoop} vertical={vertical} />
        </>
      )}
      {poseCount > 0 && (
        <div className={'flex items-center gap-1.5 ' + (vertical ? '' : 'border-l border-neutral-800 pl-2')}>
          <button
            onClick={resetPose}
            title="Reset the pose preview to bind (posing is preview — Esc works too)"
            className="flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-neutral-800 hover:text-amber-100"
          >
            <RotateCcw size={12} />
            posing · reset
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Looping-motion controls for the selected box: None / Rotate / Slide, then (when looped)
 * axis, direction, cycle speed, and slide distance. A looped joint is driven by its cycle —
 * posing it is disabled until the loop clears (see `setRigLoop`), and the loop previews
 * live in the 3D view and exports as a glTF animation clip on the joint.
 */
function LoopControls({ box, setRigLoop, vertical }: {
  box: RigBox
  setRigLoop: (id: string, loop: RigLoop | null) => void
  vertical: boolean
}) {
  const loop = isLoopActive(box.loop) ? box.loop : null
  const base: RigLoop = box.loop ?? defaultRigLoop()

  function patch(next: Partial<RigLoop>) {
    setRigLoop(box.id, { ...base, ...next })
  }

  const seg = (on: boolean) =>
    'flex h-5 items-center justify-center rounded px-1.5 text-[10px] font-medium transition ' +
    (on ? 'bg-violet-500/60 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')

  return (
    <div className={'flex items-center gap-1.5 ' + (vertical ? 'flex-wrap' : 'whitespace-nowrap border-l border-neutral-800 pl-2')}>
      <div className="flex items-center gap-0.5" role="group" aria-label="Looping motion">
        <button
          aria-label="No loop"
          title="No loop — static joint (poseable)"
          onClick={() => setRigLoop(box.id, null)}
          className={seg(!loop)}
        >
          <Ban size={12} />
        </button>
        <button
          aria-label="Loop rotation"
          title="Loop rotation — full spin about an axis (not poseable while looping)"
          onClick={() => patch({ kind: 'rotate' })}
          className={seg(loop?.kind === 'rotate')}
        >
          <RotateCw size={12} />
        </button>
        <button
          aria-label="Loop slide"
          title="Loop slide — shuttle back and forth along an axis (not poseable while looping)"
          onClick={() => patch({ kind: 'slide' })}
          className={seg(loop?.kind === 'slide')}
        >
          <ArrowLeftRight size={12} />
        </button>
      </div>
      {loop && (
        <>
          <div className="flex items-center gap-0.5" role="group" aria-label="Loop axis">
            {(['x', 'y', 'z'] as Axis[]).map((axis) => (
              <button
                key={axis}
                aria-label={`Loop axis ${axis.toUpperCase()}`}
                title={loop.kind === 'rotate' ? `Spin about ${axis.toUpperCase()}` : `Slide along ${axis.toUpperCase()}`}
                onClick={() => patch({ axis })}
                className={seg(loop.axis === axis) + ' w-5 font-mono uppercase'}
              >
                {axis}
              </button>
            ))}
          </div>
          <button
            aria-label="Flip loop direction"
            title={loop.kind === 'rotate' ? (loop.direction === 1 ? 'Counter-clockwise — click for clockwise' : 'Clockwise — click for counter-clockwise') : (loop.direction === 1 ? 'Slide +axis — click for −axis' : 'Slide −axis — click for +axis')}
            onClick={() => patch({ direction: (loop.direction === 1 ? -1 : 1) as 1 | -1 })}
            className={seg(false) + ' w-5 font-mono'}
          >
            {loop.kind === 'rotate' ? (loop.direction === 1 ? '↻' : '↺') : (loop.direction === 1 ? '+' : '−')}
          </button>
          <div className="flex items-center gap-0.5" role="group" aria-label="Loop speed">
            {([1, 2, 3] as AnimationSpeed[]).map((speed) => (
              <button
                key={speed}
                aria-label={`Loop speed ${speed}x`}
                title={`Loop cycle speed ${speed}x`}
                onClick={() => patch({ speed })}
                className={seg(loop.speed === speed) + ' px-1 font-mono'}
              >
                {speed}x
              </button>
            ))}
          </div>
          {loop.kind === 'slide' && (
            <span className="flex items-center gap-1">
              <input
                type="range"
                aria-label="Slide distance"
                title="Slide distance in voxels"
                min={SLIDE_AMOUNT_MIN}
                max={SLIDE_AMOUNT_MAX}
                value={loop.amount}
                onChange={(e) => patch({ amount: Number(e.target.value) })}
                className="h-4 w-14 accent-violet-500"
              />
              <span className="w-3 text-center font-mono text-[10px] tabular-nums text-neutral-400">{loop.amount}</span>
            </span>
          )}
        </>
      )}
    </div>
  )
}
