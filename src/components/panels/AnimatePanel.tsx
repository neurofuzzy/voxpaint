import { useMemo, useRef, useState } from 'react'
import { Bone, ChevronDown, ChevronRight, ChevronUp, Crosshair, Eye, EyeOff, Pause, Play, Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import type { Axis } from '@/engine/grid/types'
import { SLIDE_AMOUNT_MAX, SLIDE_AMOUNT_MIN } from '@/engine/animation/animationLayers'
import type { PoseCycleMode, RigBox, RigTween } from '@/engine/rigging/types'
import { activeTweens } from '@/engine/rigging/rigLoop'
import { rigPivotOf, rigSubtreeIds } from '@/engine/rigging/types'
import type { AnimationSpeed } from '@/engine/animation/types'
import { useAppStore } from '@/store/useAppStore'

type DropPosition = 'before' | 'after' | 'child'

/** Collapsible section header: chevron + label, optional right-side actions. */
function SectionHeader({ title, open, onToggle, right }: {
  title: string
  open: boolean
  onToggle: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="mb-1 flex items-center gap-1">
      <button
        onClick={onToggle}
        title={open ? 'Collapse section' : 'Expand section'}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {open ? <ChevronDown size={13} className="shrink-0 text-neutral-500" /> : <ChevronRight size={13} className="shrink-0 text-neutral-500" />}
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-400 select-none">
          {title}
        </span>
      </button>
      {right}
    </div>
  )
}

/** Visible outline rows: depth-first, honoring collapsed subtrees. */
function visibleRows(boxes: RigBox[], collapsed: Set<string>): Array<{ box: RigBox; depth: number }> {
  const children = new Map<string | null, RigBox[]>()
  for (const b of boxes) {
    const key = b.parentId && boxes.some((o) => o.id === b.parentId) ? b.parentId : null
    const list = children.get(key)
    if (list) list.push(b)
    else children.set(key, [b])
  }
  const rows: Array<{ box: RigBox; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const b of children.get(parentId) ?? []) {
      rows.push({ box: b, depth })
      if (!collapsed.has(b.id)) walk(b.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/**
 * Animate-mode docked panel (between the tool rail and the 2D view): the rig outline,
 * the selected box's inspector, and its tween stack. Consolidates what used to be three
 * surfaces (3D overlay outline, bottom-pill inspector) so all rig state lives in one
 * place. Tweens are looping procedural motions that evaluate simultaneously, composing
 * top-first — stack order is motion order (rotations don't commute), so rows reorder.
 */
export function AnimatePanel() {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)

  const box = rigBoxes.find((b) => b.id === selectedRigBoxId) ?? null

  return (
    <div className="flex w-64 min-h-0 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <OutlineSection rigBoxes={rigBoxes} selectedRigBoxId={selectedRigBoxId} />
        <div className="-mx-3 border-t border-neutral-800" />
        <InspectorSection box={box} rigBoxes={rigBoxes} />
        <div className="-mx-3 border-t border-neutral-800" />
        <PosesSection />
      </div>
    </div>
  )
}

function OutlineSection({ rigBoxes, selectedRigBoxId }: { rigBoxes: RigBox[]; selectedRigBoxId: string | null }) {
  const selectRigBox = useAppStore((s) => s.selectRigBox)
  const renameRigBox = useAppStore((s) => s.renameRigBox)
  const deleteRigBox = useAppStore((s) => s.deleteRigBox)
  const moveRigBox = useAppStore((s) => s.moveRigBox)
  const setRigPivot = useAppStore((s) => s.setRigPivot)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null)
  const [open, setOpen] = useState(true)

  const rows = useMemo(() => visibleRows(rigBoxes, collapsed), [rigBoxes, collapsed])
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of rigBoxes) {
      if (b.parentId) counts.set(b.parentId, (counts.get(b.parentId) ?? 0) + 1)
    }
    return counts
  }, [rigBoxes])

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function positionFor(e: React.DragEvent): DropPosition {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const t = (e.clientY - rect.top) / rect.height
    if (t < 0.3) return 'before'
    if (t > 0.7) return 'after'
    return 'child'
  }

  function canDrop(targetId: string): boolean {
    if (!dragId || dragId === targetId) return false
    return !rigSubtreeIds(rigBoxes, dragId).has(targetId)
  }

  function commitDrop(targetId: string | null, position: DropPosition) {
    if (!dragId) return
    if (targetId === null) {
      moveRigBox(dragId, null, 'after')
    } else {
      moveRigBox(dragId, targetId, position)
      if (position === 'child') {
        setCollapsed((prev) => {
          if (!prev.has(targetId)) return prev
          const next = new Set(prev)
          next.delete(targetId)
          return next
        })
      }
    }
    setDragId(null)
    setDrop(null)
  }

  function commitRename(id: string) {
    if (draft.trim()) renameRigBox(id, draft)
    setEditingId(null)
    setDraft('')
  }

  return (
    <section>
      <SectionHeader title={`Rig (${rigBoxes.length})`} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
      <>
      <p className="mb-2 text-[11px] leading-snug text-neutral-500">
        Tap the model with the Rig tool to box a region. Drag rows to reorder or nest.
      </p>
      {rigBoxes.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-800 px-2 py-3 text-center text-[11px] text-neutral-500">
          No rig boxes yet
        </p>
      ) : (
        <ul
          onDragOver={(e) => {
            if ((e.target as HTMLElement).closest('li')) return
            e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (!(e.target as HTMLElement).closest('li')) commitDrop(null, 'after')
          }}
        >
          {rows.map(({ box, depth }) => {
            const active = box.id === selectedRigBoxId
            const kids = childCounts.get(box.id) ?? 0
            const isCollapsed = collapsed.has(box.id)
            const dropHere = drop?.id === box.id ? drop.position : null
            const dimmed = dragId !== null && !canDrop(box.id) && dragId !== box.id
            const tweenCount = activeTweens(box).length
            return (
              <li key={box.id}>
                {dropHere === 'before' && <div className="h-0.5 rounded bg-violet-400" />}
                <div
                  draggable={editingId === null}
                  onDragStart={(e) => {
                    e.stopPropagation()
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', box.id)
                    setDragId(box.id)
                    setDrop(null)
                  }}
                  onDragOver={(e) => {
                    if (!dragId || !canDrop(box.id)) return
                    e.preventDefault()
                    e.stopPropagation()
                    e.dataTransfer.dropEffect = 'move'
                    const position = positionFor(e)
                    setDrop((prev) => (prev?.id === box.id && prev.position === position ? prev : { id: box.id, position }))
                  }}
                  onDragLeave={() => {
                    setDrop((prev) => (prev?.id === box.id ? null : prev))
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (canDrop(box.id)) commitDrop(box.id, positionFor(e))
                    else {
                      setDragId(null)
                      setDrop(null)
                    }
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setDrop(null)
                  }}
                  onClick={() => selectRigBox(active ? null : box.id)}
                  style={{ marginLeft: depth * 14 }}
                  className={
                    'flex items-center gap-1 rounded-md border px-1 py-1 cursor-grab active:cursor-grabbing ' +
                    (dropHere === 'child'
                      ? 'border-violet-400 bg-violet-500/20'
                      : active
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-neutral-800 hover:bg-neutral-800/60') +
                    (dimmed ? ' opacity-40' : '')
                  }
                >
                  {kids > 0 ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleCollapsed(box.id) }}
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-500 hover:text-neutral-200"
                    >
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  {editingId === box.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(box.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(box.id)
                        if (e.key === 'Escape') { setEditingId(null); setDraft('') }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  ) : (
                    <button
                      onDoubleClick={() => { setEditingId(box.id); setDraft(box.name) }}
                      title="Double-click to rename"
                      className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-neutral-200"
                    >
                      {box.name}
                    </button>
                  )}
                  {tweenCount > 0 && (
                    <span title={`${tweenCount} active tween${tweenCount === 1 ? '' : 's'}`} className="shrink-0 rounded bg-violet-500/20 px-1 font-mono text-[10px] text-violet-300">
                      ~{tweenCount}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (box.pivot) {
                        setRigPivot(box.id, null)
                      } else {
                        selectRigBox(box.id)
                        setActiveTool('pivot')
                      }
                    }}
                    title={
                      box.pivot
                        ? `Pivot at (${box.pivot[0]}, ${box.pivot[1]}, ${box.pivot[2]}) — click to reset to box center`
                        : 'No pivot override (rotates about box center) — click to set one with the Pivot tool'
                    }
                    className={
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-neutral-800 ' +
                      (box.pivot ? 'text-violet-400 hover:text-violet-200' : 'text-neutral-600 hover:text-neutral-300')
                    }
                  >
                    <Crosshair size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteRigBox(box.id) }}
                    title={`Delete ${box.name}${kids > 0 ? ' (children move up)' : ''}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {dropHere === 'after' && <div className="h-0.5 rounded bg-violet-400" />}
              </li>
            )
          })}
        </ul>
      )}
      </>
      )}
    </section>
  )
}

function InspectorSection({ box, rigBoxes }: { box: RigBox | null; rigBoxes: RigBox[] }) {
  const renameRigBox = useAppStore((s) => s.renameRigBox)
  const setRigPivot = useAppStore((s) => s.setRigPivot)
  const poseCount = useAppStore((s) => s.poseRotations.size)
  const resetPose = useAppStore((s) => s.resetPose)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(true)

  if (!box) {
    return (
      <section>
        <SectionHeader title="Properties" open={open} onToggle={() => setOpen((v) => !v)} />
        {open && (
          <div className="flex items-center gap-2 text-neutral-500">
            <Bone size={16} className="shrink-0" />
            <div>
              <p className="text-[11px] font-medium text-neutral-300">
                {rigBoxes.length === 0 ? 'No rig boxes yet' : 'No box selected'}
              </p>
              <p className="text-[10px]">pick it in the outline or tap its footprint in 2D</p>
            </div>
          </div>
        )}
      </section>
    )
  }

  function commitRename() {
    if (draft.trim()) renameRigBox(box!.id, draft)
    setEditing(false)
    setDraft('')
  }

  const pivot = rigPivotOf(box)
  const custom = box.pivot !== null

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Properties" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
      <>
      <div className="flex min-w-0 items-center gap-2">
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
      <div className="flex items-center gap-1.5">
        <span className="whitespace-nowrap font-mono text-[10px] text-neutral-500" title={custom ? 'Rotation-center override (half-integers sit on cell boundaries — rotate the plane to place depth)' : 'Rotation center is the box center — click with the Pivot tool to move it'}>
          {custom ? `pivot (${pivot[0]}, ${pivot[1]}, ${pivot[2]})` : 'pivot: center'}
        </span>
        {custom && (
          <button
            onClick={() => setRigPivot(box.id, null)}
            title="Reset rotation center to box center"
            className="flex h-5 w-5 items-center justify-center rounded text-violet-400 hover:bg-neutral-800 hover:text-violet-200"
          >
            <Crosshair size={12} />
          </button>
        )}
      </div>
      {poseCount > 0 && (
        <button
          onClick={resetPose}
          title="Reset the pose preview to bind (posing is preview — Esc works too)"
          className="flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-neutral-800 hover:text-amber-100"
        >
          <RotateCcw size={12} />
          posing · reset
        </button>
      )}
      <TweenStack box={box} />
      </>
      )}
    </section>
  )
}

/**
 * The box's tween stack: ordered looping motions, all enabled entries evaluating
 * simultaneously and composing top-first. Add/remove/reorder/mute per row; params edit
 * in place. Slider drags bracket one undo stroke (down → up); lone edits self-bracket.
 */
function TweenStack({ box }: { box: RigBox }) {
  const addTween = useAppStore((s) => s.addTween)
  const tweens = box.tweens ?? []

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-neutral-300 select-none">
          Tweens ({tweens.filter((t) => t.enabled).length}/{tweens.length} on)
        </span>
        <button
          onClick={() => addTween(box.id)}
          title="Add a looping motion (spin about Y — edit it below)"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-neutral-800 hover:text-violet-100"
        >
          <Plus size={12} />
          add tween
        </button>
      </div>
      {tweens.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-800 px-2 py-2 text-[10px] leading-snug text-neutral-500">
          No motion — this joint is static (poseable). Stacked tweens play together, top first.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tweens.map((tween, i) => (
            <TweenRow key={tween.id} boxId={box.id} tween={tween} index={i} count={tweens.length} />
          ))}
        </ul>
      )}
    </div>
  )
}

function seg(on: boolean) {
  return (
    'flex h-5 items-center justify-center rounded px-1.5 text-[10px] font-medium transition ' +
    (on ? 'bg-violet-500/60 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
  )
}

function TweenRow({ boxId, tween, index, count }: { boxId: string; tween: RigTween; index: number; count: number }) {
  const removeTween = useAppStore((s) => s.removeTween)
  const moveTween = useAppStore((s) => s.moveTween)
  const setTweenEnabled = useAppStore((s) => s.setTweenEnabled)
  const patchTween = useAppStore((s) => s.patchTween)
  const animBeginStroke = useAppStore((s) => s.animBeginStroke)
  const animCommitStroke = useAppStore((s) => s.animCommitStroke)
  // Coalesced slider stroke: opened on pointer-down, committed on up/cancel. Keyboard
  // nudges skip the bracket and self-bracket singly via patchTween's nesting.
  const sliding = useRef(false)
  function slideStart() {
    if (!sliding.current) {
      sliding.current = true
      animBeginStroke()
    }
  }
  function slideEnd() {
    if (sliding.current) {
      sliding.current = false
      animCommitStroke()
    }
  }

  const stacked = count > 1
  return (
    <li className={'flex flex-col gap-1.5 rounded-md border px-2 py-2 ' + (tween.enabled ? 'border-neutral-800' : 'border-neutral-800/60 opacity-60')}>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-200">
          {stacked ? `Motion ${index + 1} of ${count}` : 'Motion'}
          {!tween.enabled && <span className="text-neutral-500"> · muted</span>}
        </span>
        <button
          onClick={() => setTweenEnabled(boxId, tween.id, !tween.enabled)}
          title={tween.enabled ? 'Mute this tween (params kept)' : 'Unmute this tween'}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          {tween.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        {stacked && (
          <>
            <button
              onClick={() => moveTween(boxId, tween.id, -1)}
              disabled={index === 0}
              title="Move up (composes earlier = more outer)"
              className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronUp size={12} />
            </button>
            <button
              onClick={() => moveTween(boxId, tween.id, 1)}
              disabled={index === count - 1}
              title="Move down (composes later = more inner)"
              className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronDown size={12} />
            </button>
          </>
        )}
        <button
          onClick={() => removeTween(boxId, tween.id)}
          title="Delete this tween"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500">Type</span>
          <button
            aria-label={tween.kind === 'rotate' ? 'Spin — click for shuttle' : 'Shuttle — click for spin'}
            onClick={() => patchTween(boxId, tween.id, { kind: tween.kind === 'rotate' ? 'slide' : 'rotate' })}
            title={tween.kind === 'rotate' ? 'Turntable spin, full turn per cycle — click for shuttle' : 'Axial shuttle, sine back and forth — click for spin'}
            className={seg(true) + ' w-full'}
          >
            {tween.kind === 'rotate' ? 'Spin' : 'Shuttle'}
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500">Axis</span>
          <button
            aria-label={`Axis ${tween.axis.toUpperCase()} — click for next axis`}
            onClick={() => {
              const order: Axis[] = ['x', 'y', 'z']
              patchTween(boxId, tween.id, { axis: order[(order.indexOf(tween.axis) + 1) % order.length] })
            }}
            title={tween.kind === 'rotate' ? `Spin about ${tween.axis.toUpperCase()} — click for next axis` : `Shuttle along ${tween.axis.toUpperCase()} — click for next axis`}
            className={seg(true) + ' w-full font-mono uppercase'}
          >
            {tween.axis}
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500">Direction</span>
          {tween.kind === 'rotate' ? (
            <button
              aria-label={tween.direction === 1 ? 'Counter-clockwise spin — click for clockwise' : 'Clockwise spin — click for counter-clockwise'}
              onClick={() => patchTween(boxId, tween.id, { direction: (tween.direction === 1 ? -1 : 1) as 1 | -1 })}
              title={tween.direction === 1 ? 'Counter-clockwise — click for clockwise' : 'Clockwise — click for counter-clockwise'}
              className={seg(true) + ' w-full'}
            >
              {tween.direction === 1 ? <RotateCcw size={12} /> : <RotateCw size={12} />}
            </button>
          ) : (
            <button
              aria-label={tween.direction === 1 ? `Shuttle toward +${tween.axis.toUpperCase()} — click to flip` : `Shuttle toward −${tween.axis.toUpperCase()} — click to flip`}
              onClick={() => patchTween(boxId, tween.id, { direction: (tween.direction === 1 ? -1 : 1) as 1 | -1 })}
              title="Click to flip the shuttle direction"
              className={seg(true) + ' w-full font-mono'}
            >
              {tween.direction === 1 ? `+${tween.axis.toUpperCase()}` : `−${tween.axis.toUpperCase()}`}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500">Speed</span>
          <button
            aria-label={`Cycle speed ${tween.speed}x — click for next speed`}
            onClick={() => {
              const order: AnimationSpeed[] = [1, 2, 3]
              patchTween(boxId, tween.id, { speed: order[(order.indexOf(tween.speed) + 1) % order.length] })
            }}
            title={`Cycle speed ${tween.speed}x — click for next speed`}
            className={seg(true) + ' w-full px-1 font-mono'}
          >
            {tween.speed}×
          </button>
        </div>
      </div>
      {tween.kind === 'slide' && (
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] text-neutral-500">Distance</span>
          <input
            type="range"
            aria-label="Slide distance in voxels"
            title="Slide distance in voxels"
            min={SLIDE_AMOUNT_MIN}
            max={SLIDE_AMOUNT_MAX}
            value={tween.amount}
            onPointerDown={slideStart}
            onPointerUp={slideEnd}
            onPointerCancel={slideEnd}
            onChange={(e) => patchTween(boxId, tween.id, { amount: Number(e.target.value) })}
            className="h-4 min-w-0 flex-1 accent-violet-500"
          />
          <span className="w-12 shrink-0 font-mono text-[10px] tabular-nums text-neutral-400">{tween.amount} vx</span>
        </div>
      )}
    </li>
  )
}

/**
 * The pose library: named joint snapshots captured from the gizmo scratch. Click a row
 * to stage it for preview (click again to unstage back to the scratch); grabbing the
 * gizmo while staged adopts it into the scratch first, so you grab what you see.
 * Capture freezes the current scratch into a new pose and stages it.
 */
function PosesSection() {
  const poses = useAppStore((s) => s.poses)
  const stagedPoseId = useAppStore((s) => s.stagedPoseId)
  const scratchSize = useAppStore((s) => s.poseRotations.size)
  const capturePose = useAppStore((s) => s.capturePose)
  const renamePose = useAppStore((s) => s.renamePose)
  const deletePose = useAppStore((s) => s.deletePose)
  const stagePose = useAppStore((s) => s.stagePose)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(true)

  function commitRename(id: string) {
    if (draft.trim()) renamePose(id, draft)
    setEditingId(null)
    setDraft('')
  }

  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeader
        title={`Poses (${poses.length})`}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        right={
          <button
            onClick={() => capturePose()}
            disabled={scratchSize === 0}
            title={scratchSize === 0 ? 'Pose something first — the scratch is at bind' : 'Freeze the current gizmo pose into a named pose'}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-neutral-800 hover:text-violet-100 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Plus size={12} />
            capture
          </button>
        }
      />
      {open && (
      <>
      <CycleBar />
      {poses.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-800 px-2 py-2 text-[10px] leading-snug text-neutral-500">
          No poses yet — pose with the gizmo, then capture it here to keep it.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {poses.map((pose) => {
            const staged = pose.id === stagedPoseId
            const joints = Object.keys(pose.joints).length
            return (
              <li key={pose.id}>
                <div
                  onClick={() => stagePose(staged ? null : pose.id)}
                  title={staged ? 'Unstage — back to the live scratch' : 'Stage for preview (gizmo grabs adopt it)'}
                  className={
                    'flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 ' +
                    (staged ? 'border-violet-500/60 bg-violet-500/10' : 'border-neutral-800 hover:bg-neutral-800/60')
                  }
                >
                  {editingId === pose.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(pose.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(pose.id)
                        if (e.key === 'Escape') { setEditingId(null); setDraft('') }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  ) : (
                    <button
                      onDoubleClick={() => { setEditingId(pose.id); setDraft(pose.name) }}
                      title="Double-click to rename"
                      className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-neutral-200"
                    >
                      {pose.name}
                    </button>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-neutral-500">
                    {joints} joint{joints === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deletePose(pose.id) }}
                    title={`Delete ${pose.name}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      </>
      )}
    </section>
  )
}

/**
 * Pose-to-pose playback bar: From → To pickers, Once/Loop/Ping-pong mode, speed, and
 * transport. The cycle interpolates every joint and loops without a timeline; grabbing
 * the gizmo freezes the current frame into the scratch and stops transport.
 */
function CycleBar() {
  const poses = useAppStore((s) => s.poses)
  const poseCycle = useAppStore((s) => s.poseCycle)
  const cyclePlaying = useAppStore((s) => s.cyclePlaying)
  const setPoseCycle = useAppStore((s) => s.setPoseCycle)
  const setCyclePlaying = useAppStore((s) => s.setCyclePlaying)

  const canDefine = poses.length >= 2
  function patch(next: Partial<NonNullable<typeof poseCycle>> & { fromId: string; toId: string }) {
    if (!canDefine) return
    const base = poseCycle ?? { fromId: next.fromId, toId: next.toId, mode: 'pingpong' as const, speed: 1 as const }
    setPoseCycle({ ...base, ...next })
  }

  const canPlay = canDefine && poseCycle !== null

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-neutral-800 px-2 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-neutral-500">Cycle</span>
        <span className="min-w-0 flex-1" />
        <button
          onClick={() => setCyclePlaying(!cyclePlaying)}
          disabled={!canPlay}
          title={!canPlay ? 'Define a from/to pair first' : cyclePlaying ? 'Stop the cycle' : 'Play the cycle'}
          className="flex h-5 w-5 items-center justify-center rounded text-violet-300 hover:bg-neutral-800 hover:text-violet-100 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          {cyclePlaying ? <Pause size={12} /> : <Play size={12} />}
        </button>
      </div>
      {!canDefine && (
        <p className="text-[10px] leading-snug text-neutral-500">
          Capture at least two poses to loop between them.
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[10px] text-neutral-500">From</span>
        <select
          value={poseCycle?.fromId ?? ''}
          onChange={(e) => {
            const fromId = e.target.value
            if (!fromId) return
            patch({ fromId, toId: poseCycle?.toId && poses.some((p) => p.id === poseCycle.toId) ? poseCycle.toId : fromId })
          }}
          disabled={!canDefine}
          className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-40"
        >
          {poses.length === 0 && <option value="">—</option>}
          {poses.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[10px] text-neutral-500">To</span>
        <select
          value={poseCycle?.toId ?? ''}
          onChange={(e) => {
            const toId = e.target.value
            if (!toId || !poseCycle) return
            patch({ fromId: poseCycle.fromId, toId })
          }}
          disabled={!canDefine}
          className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-40"
        >
          {poses.length === 0 && <option value="">—</option>}
          {poses.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-0.5" role="group" aria-label="Cycle mode">
          {(['once', 'loop', 'pingpong'] as PoseCycleMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => poseCycle && setPoseCycle({ ...poseCycle, mode })}
              disabled={!poseCycle}
              title={mode === 'once' ? 'Play A→B once, then hold B' : mode === 'loop' ? 'Loop A→B with a jump back' : 'Ease A→B→A seamlessly'}
              className={
                'flex h-5 items-center justify-center rounded px-1.5 text-[10px] font-medium transition disabled:opacity-30 ' +
                (poseCycle?.mode === mode ? 'bg-violet-500/60 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
              }
            >
              {mode === 'once' ? 'Once' : mode === 'loop' ? 'Loop' : 'Ping-pong'}
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1" />
        <div className="flex items-center gap-0.5" role="group" aria-label="Cycle speed">
          {([1, 2, 3] as AnimationSpeed[]).map((speed) => (
            <button
              key={speed}
              onClick={() => poseCycle && setPoseCycle({ ...poseCycle, speed })}
              disabled={!poseCycle}
              title={`Cycle speed ${speed}x`}
              className={
                'flex h-5 items-center justify-center rounded px-1 font-mono text-[10px] transition disabled:opacity-30 ' +
                (poseCycle?.speed === speed ? 'bg-violet-500/60 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
              }
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
