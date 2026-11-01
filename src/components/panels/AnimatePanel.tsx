import { useMemo, useRef, useState } from 'react'
import { Bone, ChevronDown, ChevronRight, ChevronUp, Copy, Crosshair, Eye, EyeOff, FlipHorizontal2, Pause, Play, Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import type { Axis } from '@/engine/grid/types'
import { SLIDE_AMOUNT_MAX, SLIDE_AMOUNT_MIN } from '@/engine/animation/animationLayers'
import type { ClipKey, RigBox, RigClip, RigTween } from '@/engine/rigging/types'
import { PENDULUM_TWEEN_ANGLE_MAX, PENDULUM_TWEEN_ANGLE_MIN } from '@/engine/rigging/types'
import { activeTweens } from '@/engine/rigging/rigLoop'
import { rigPivotOf, rigSubtreeIds } from '@/engine/rigging/types'
import type { AnimationSpeed } from '@/engine/animation/types'
import type { AnimateTab } from '@/store/types'
import { clampKeyTime } from '@/store/poseSlice'
import { useAppStore } from '@/store/useAppStore'

type DropPosition = 'before' | 'after' | 'child'

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
 * Animate-mode docked panel (left of the tool rail), tabbed into three concerns:
 * Rig (outline + selected-box properties), Tweens (every box's motion stack — new
 * tweens land on the selection), and Poses (clip timelines of keyed poses + the named
 * pose library). The focused tab drives the contextual toolbar next to it, so taps
 * always dispatch somewhere sensible. Only one motion tab shows per project: Rig +
 * Tweens for machines, Rig + Poses for characters (see the mode toggle). Tweens
 * are looping procedural motions that evaluate simultaneously, composing top-first —
 * stack order is motion order (rotations don't commute), so rows reorder.
 */
const TABS: Array<{ id: AnimateTab; label: string }> = [
  { id: 'rig', label: 'Rig' },
  { id: 'tweens', label: 'Tweens' },
  { id: 'poses', label: 'Poses' },
]

export function AnimatePanel() {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const tab = useAppStore((s) => s.animateTab)
  const setTab = useAppStore((s) => s.setAnimateTab)
  const animationMode = useAppStore((s) => s.meta.animationMode ?? 'tweens')

  const box = rigBoxes.find((b) => b.id === selectedRigBoxId) ?? null
  // One motion tab per project: machines get Rig + Tweens, characters get Rig + Poses.
  const tabs = TABS.filter((t) => t.id === 'rig' || (animationMode === 'tweens' ? t.id === 'tweens' : t.id === 'poses'))

  return (
    <div className="flex w-64 min-h-0 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900">
      <ModeToggle />
      <div className="flex gap-1 border-b border-neutral-800 p-2" role="tablist" aria-label="Animate panel tabs">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={seg(tab === id) + ' flex-1'}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {tab === 'rig' && (
          <>
            <OutlineSection rigBoxes={rigBoxes} selectedRigBoxId={selectedRigBoxId} />
            <div className="-mx-3 border-t border-neutral-800" />
            <InspectorSection box={box} rigBoxes={rigBoxes} />
          </>
        )}
        {tab === 'tweens' && animationMode === 'tweens' && <TweensSection boxes={rigBoxes} />}
        {tab === 'poses' && animationMode === 'poses' && <PosesSection />}
      </div>
    </div>
  )
}

/**
 * Project animation-system switch: machines loop per-joint tweens, characters play
 * keyed pose clips — never both. Switching keeps the other mode's data (tweens stay on
 * their boxes, poses and clips stay in the file) but mutes it; export writes only the
 * active mode.
 */
function ModeToggle() {
  const animationMode = useAppStore((s) => s.meta.animationMode ?? 'tweens')
  const setAnimationMode = useAppStore((s) => s.setAnimationMode)
  return (
    <div className="flex gap-1 p-2 pb-0" role="group" aria-label="Animation mode">
      <button
        aria-pressed={animationMode === 'tweens'}
        onClick={() => setAnimationMode('tweens')}
        title="Machine: per-joint looping tweens (rotate, pendulum, slide)"
        className={seg(animationMode === 'tweens') + ' flex-1'}
      >
        Machine
      </button>
      <button
        aria-pressed={animationMode === 'poses'}
        onClick={() => setAnimationMode('poses')}
        title="Character: keyed pose clips on a timeline (walk, idle, dodge)"
        className={seg(animationMode === 'poses') + ' flex-1'}
      >
        Character
      </button>
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
  const animationMode = useAppStore((s) => s.meta.animationMode ?? 'tweens')
  const setAnimationMode = useAppStore((s) => s.setAnimationMode)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null)

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
      <p className="mb-2 text-[11px] leading-snug text-neutral-500">
        Tap the model with the Rig tool to box a region. Drag rows to reorder or nest.
      </p>
      {rigBoxes.length === 0 ? (
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => setAnimationMode('tweens')}
            aria-pressed={animationMode === 'tweens'}
            title="Machine: per-joint looping tweens — pick it to box a region for wheels, fans, doors"
            className={
              'rounded-md border px-2 py-2 text-left ' +
              (animationMode === 'tweens'
                ? 'border-violet-500/60 bg-violet-500/10'
                : 'border-neutral-800 hover:bg-neutral-800/60')
            }
          >
            <span className="block text-[11px] font-semibold text-neutral-100">Machine</span>
            <span className="block text-[10px] leading-snug text-neutral-500">
              Looping tweens per joint — wheels, fans, doors
            </span>
          </button>
          <button
            onClick={() => setAnimationMode('poses')}
            aria-pressed={animationMode === 'poses'}
            title="Character: keyed poses on clips — pick it to box a region for walk, idle, dodge"
            className={
              'rounded-md border px-2 py-2 text-left ' +
              (animationMode === 'poses'
                ? 'border-violet-500/60 bg-violet-500/10'
                : 'border-neutral-800 hover:bg-neutral-800/60')
            }
          >
            <span className="block text-[11px] font-semibold text-neutral-100">Character</span>
            <span className="block text-[10px] leading-snug text-neutral-500">
              Poses keyed on clips — walk, idle, dodge
            </span>
          </button>
        </div>
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
    </section>
  )
}

function InspectorSection({ box, rigBoxes }: { box: RigBox | null; rigBoxes: RigBox[] }) {
  const renameRigBox = useAppStore((s) => s.renameRigBox)
  const setRigPivot = useAppStore((s) => s.setRigPivot)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!box) {
    return (
      <section>
        <div className="flex items-center gap-2 text-neutral-500">
          <Bone size={16} className="shrink-0" />
          <div>
            <p className="text-[11px] font-medium text-neutral-300">
              {rigBoxes.length === 0 ? 'No rig boxes yet' : 'No box selected'}
            </p>
            <p className="text-[10px]">pick it in the outline or tap its footprint in 2D</p>
          </div>
        </div>
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
    </section>
  )
}

/**
 * Every box's tween stack, in outline order: ordered looping motions, all enabled
 * entries evaluating simultaneously and composing top-first. Remove/reorder/mute
 * per row; params edit in place. New tweens land on the selected box, so the add
 * button stays disabled until one is picked (click a group header to select it).
 */
function TweensSection({ boxes }: { boxes: RigBox[] }) {
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const selectRigBox = useAppStore((s) => s.selectRigBox)
  const addTween = useAppStore((s) => s.addTween)
  const moveTweenToBox = useAppStore((s) => s.moveTweenToBox)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Cross-box tween drag: the dragged row plus the current drop slot (box + insertion
  // index, counting pre-removal rows like the visual list — see moveTweenToBox).
  const [tweenDrag, setTweenDrag] = useState<{ boxId: string; tweenId: string } | null>(null)
  const [tweenDrop, setTweenDrop] = useState<{ boxId: string; index: number } | null>(null)

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearTweenDrag() {
    setTweenDrag(null)
    setTweenDrop(null)
  }

  /** Visual drop slot for a row hover: upper half inserts before, lower half after. */
  function rowDropIndex(e: React.DragEvent, index: number): number {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return (e.clientY - rect.top) / rect.height < 0.5 ? index : index + 1
  }

  if (boxes.length === 0) {
    return (
      <section>
        <p className="rounded-md border border-dashed border-neutral-800 px-2 py-3 text-center text-[11px] text-neutral-500">
          No rig boxes yet — box a region in the Rig tab first.
        </p>
      </section>
    )
  }
  const selected = boxes.find((b) => b.id === selectedRigBoxId) ?? null
  const onCount = boxes.reduce((n, b) => n + (b.tweens ?? []).filter((t) => t.enabled).length, 0)
  const totalCount = boxes.reduce((n, b) => n + (b.tweens ?? []).length, 0)

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-neutral-300 select-none">
          Tweens ({onCount}/{totalCount} on)
        </span>
        <button
          onClick={() => selected && addTween(selected.id)}
          disabled={!selected}
          title={selected ? `Add a looping motion to ${selected.name} (spin about Y — edit it below)` : 'Select a box first — new tweens land on the selection'}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-neutral-800 hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Plus size={12} />
          add tween
        </button>
      </div>
      {boxes.map((box) => {
        const tweens = box.tweens ?? []
        const active = box.id === selectedRigBoxId
        const isCollapsed = collapsed.has(box.id)
        // A drop onto the header (or an empty/collapsed group) appends to the stack.
        const groupTargeted = tweenDrag !== null && tweenDrop?.boxId === box.id && (isCollapsed || tweens.length === 0)
        return (
          <div
            key={box.id}
            className="flex flex-col gap-1.5"
            onDragOver={(e) => {
              if (!tweenDrag || (e.target as HTMLElement).closest('li')) return
              e.preventDefault()
              setTweenDrop((prev) => (prev?.boxId === box.id && prev.index === tweens.length ? prev : { boxId: box.id, index: tweens.length }))
            }}
            onDrop={(e) => {
              if (!tweenDrag) return
              e.preventDefault()
              moveTweenToBox(tweenDrag.boxId, tweenDrag.tweenId, box.id)
              clearTweenDrag()
            }}
          >
            <div
              onClick={() => selectRigBox(active ? null : box.id)}
              title={active ? 'Deselect — the add button disables with no selection' : `Select ${box.name} — new tweens land here`}
              className={
                'flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 text-left ' +
                (groupTargeted
                  ? 'border-violet-400 bg-violet-500/20'
                  : active ? 'border-violet-500/60 bg-violet-500/10' : 'border-neutral-800 hover:bg-neutral-800/60')
              }
            >
              {tweens.length > 0 ? (
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
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-200">
                {box.name}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-neutral-500">
                {tweens.filter((t) => t.enabled).length}/{tweens.length} on
              </span>
            </div>
            {!isCollapsed && tweens.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {tweens.map((tween, i) => (
                  <TweenRow
                    key={tween.id}
                    boxId={box.id}
                    tween={tween}
                    index={i}
                    count={tweens.length}
                    dropSlot={tweenDrop?.boxId === box.id ? (tweenDrop.index === i ? 'before' : tweenDrop.index === i + 1 ? 'after' : null) : null}
                    dimmed={tweenDrag !== null && !(tweenDrag.boxId === box.id && tweenDrag.tweenId === tween.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', `${box.id}:${tween.id}`)
                      setTweenDrag({ boxId: box.id, tweenId: tween.id })
                      setTweenDrop(null)
                    }}
                    onDragEnd={clearTweenDrag}
                    onDragOver={(e) => {
                      if (!tweenDrag) return
                      e.preventDefault()
                      e.stopPropagation()
                      const at = rowDropIndex(e, i)
                      setTweenDrop((prev) => (prev?.boxId === box.id && prev.index === at ? prev : { boxId: box.id, index: at }))
                    }}
                    onDrop={(e) => {
                      if (!tweenDrag) return
                      e.preventDefault()
                      e.stopPropagation()
                      moveTweenToBox(tweenDrag.boxId, tweenDrag.tweenId, box.id, rowDropIndex(e, i))
                      clearTweenDrag()
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}

function seg(on: boolean) {
  return (
    'flex h-5 items-center justify-center rounded px-1.5 text-[10px] font-medium transition ' +
    (on ? 'bg-violet-500/60 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
  )
}

/** Kind cycle order for the type button: spin → pendulum → shuttle. */
const TWEEN_KIND_ORDER: Array<RigTween['kind']> = ['rotate', 'pendulum', 'slide']
const TWEEN_KIND_LABEL: Record<RigTween['kind'], string> = { rotate: 'Spin', pendulum: 'Pendulum', slide: 'Shuttle' }
const TWEEN_KIND_HINT: Record<RigTween['kind'], string> = {
  rotate: 'Turntable spin, full turn per cycle — click for pendulum',
  pendulum: 'Swing between min/max angles, sine back and forth — click for shuttle',
  slide: 'Axial shuttle, sine back and forth — click for spin',
}

function TweenRow({ boxId, tween, index, count, dropSlot, dimmed, onDragStart, onDragEnd, onDragOver, onDrop }: {
  boxId: string
  tween: RigTween
  index: number
  count: number
  /** Drop indicator for a cross-box drag: line above/below this row, else null. */
  dropSlot: 'before' | 'after' | null
  /** Dimmed while another row is being dragged. */
  dimmed: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}) {
  const removeTween = useAppStore((s) => s.removeTween)
  const moveTween = useAppStore((s) => s.moveTween)
  const duplicateTween = useAppStore((s) => s.duplicateTween)
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
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={dimmed ? 'opacity-40' : ''}
    >
      {dropSlot === 'before' && <div className="h-0.5 rounded bg-violet-400" />}
      <div
        className={'flex cursor-grab flex-col gap-1.5 rounded-md border px-2 py-2 active:cursor-grabbing ' + (tween.enabled ? 'border-neutral-800' : 'border-neutral-800/60 opacity-60')}
        title="Drag onto another box's group to move it there"
      >
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
          onClick={() => duplicateTween(boxId, tween.id)}
          title="Duplicate this tween (inserts a copy right below)"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Copy size={12} />
        </button>
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
            aria-label={`${TWEEN_KIND_LABEL[tween.kind]} — click for ${TWEEN_KIND_LABEL[TWEEN_KIND_ORDER[(TWEEN_KIND_ORDER.indexOf(tween.kind) + 1) % TWEEN_KIND_ORDER.length]]}`}
            onClick={() => patchTween(boxId, tween.id, { kind: TWEEN_KIND_ORDER[(TWEEN_KIND_ORDER.indexOf(tween.kind) + 1) % TWEEN_KIND_ORDER.length] })}
            title={TWEEN_KIND_HINT[tween.kind]}
            className={seg(true) + ' w-full'}
          >
            {TWEEN_KIND_LABEL[tween.kind]}
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
            title={`${TWEEN_KIND_LABEL[tween.kind]} ${tween.kind === 'slide' ? 'along' : 'about'} ${tween.axis.toUpperCase()} — click for next axis`}
            className={seg(true) + ' w-full font-mono uppercase'}
          >
            {tween.axis}
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500">Direction</span>
          {tween.kind === 'pendulum' ? (
            <button
              aria-label={tween.direction === 1 ? 'Pendulum starts at min — click to start at max' : 'Pendulum starts at max — click to start at min'}
              onClick={() => patchTween(boxId, tween.id, { direction: (tween.direction === 1 ? -1 : 1) as 1 | -1 })}
              title={tween.direction === 1 ? 'Starts at min, swings to max first — click to start at max' : 'Starts at max, swings to min first — click to start at min'}
              className={seg(true) + ' w-full font-mono text-[10px]'}
            >
              {tween.direction === 1 ? 'min→max' : 'max→min'}
            </button>
          ) : tween.kind === 'rotate' ? (
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
      {tween.kind === 'pendulum' && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] text-neutral-500">Min angle</span>
            <input
              type="range"
              aria-label="Pendulum minimum angle in degrees"
              title="Pendulum minimum angle in degrees"
              min={PENDULUM_TWEEN_ANGLE_MIN}
              max={PENDULUM_TWEEN_ANGLE_MAX}
              value={tween.minAngle}
              onPointerDown={slideStart}
              onPointerUp={slideEnd}
              onPointerCancel={slideEnd}
              onChange={(e) => patchTween(boxId, tween.id, { minAngle: Number(e.target.value) })}
              className="h-4 min-w-0 flex-1 accent-violet-500"
            />
            <span className="w-12 shrink-0 font-mono text-[10px] tabular-nums text-neutral-400">{tween.minAngle}°</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] text-neutral-500">Max angle</span>
            <input
              type="range"
              aria-label="Pendulum maximum angle in degrees"
              title="Pendulum maximum angle in degrees"
              min={PENDULUM_TWEEN_ANGLE_MIN}
              max={PENDULUM_TWEEN_ANGLE_MAX}
              value={tween.maxAngle}
              onPointerDown={slideStart}
              onPointerUp={slideEnd}
              onPointerCancel={slideEnd}
              onChange={(e) => patchTween(boxId, tween.id, { maxAngle: Number(e.target.value) })}
              className="h-4 min-w-0 flex-1 accent-violet-500"
            />
            <span className="w-12 shrink-0 font-mono text-[10px] tabular-nums text-neutral-400">{tween.maxAngle}°</span>
          </div>
        </>
      )}
      </div>
      {dropSlot === 'after' && <div className="h-0.5 rounded bg-violet-400" />}
    </li>
  )
}

/**
 * The pose library: named joint snapshots captured from the gizmo scratch. Click a row
 * to stage it for preview (click again to unstage back to the scratch); grabbing the
 * gizmo while staged adopts it into the scratch first, so you grab what you see.
 * Capture freezes the current scratch into a new pose and stages it. Clips (above)
 * sequence these snapshots on a timeline — one exported action each.
 */
function PosesSection() {
  const poses = useAppStore((s) => s.poses)
  const stagedPoseId = useAppStore((s) => s.stagedPoseId)
  const editingPoseId = useAppStore((s) => s.editingPoseId)
  const scratchSize = useAppStore((s) => s.poseRotations.size)
  const capturePose = useAppStore((s) => s.capturePose)
  const overwritePose = useAppStore((s) => s.overwritePose)
  const mirrorPose = useAppStore((s) => s.mirrorPose)
  const renamePose = useAppStore((s) => s.renamePose)
  const deletePose = useAppStore((s) => s.deletePose)
  const stagePose = useAppStore((s) => s.stagePose)
  const resetPose = useAppStore((s) => s.resetPose)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function commitRename(id: string) {
    if (draft.trim()) renamePose(id, draft)
    setEditingId(null)
    setDraft('')
  }

  const editingPose = poses.find((p) => p.id === editingPoseId) ?? null

  return (
    <section className="flex flex-col gap-1.5">
      <ClipsSection />
      <div className="-mx-3 border-t border-neutral-800" />
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-neutral-400 select-none">
          Poses ({poses.length})
        </span>
        {editingPose && scratchSize > 0 && (
          <button
            onClick={() => overwritePose(editingPose.id)}
            title={`Write the scratch back into ${editingPose.name} — every key using it updates`}
            className="flex max-w-28 items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-neutral-800 hover:text-violet-100"
          >
            Update {editingPose.name}
          </button>
        )}
        {scratchSize > 0 && (
          <button
            onClick={resetPose}
            title="Reset the pose preview to bind (posing is preview — Esc works too)"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-neutral-800 hover:text-amber-100"
          >
            <RotateCcw size={12} />
            reset
          </button>
        )}
        <button
          onClick={() => capturePose()}
          disabled={scratchSize === 0}
          title={scratchSize === 0 ? 'Pose something first — the scratch is at bind' : 'Freeze the current gizmo pose into a named pose'}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-neutral-800 hover:text-violet-100 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Plus size={12} />
          capture
        </button>
      </div>
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
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData('application/x-voxpaint-pose', pose.id)
                  }}
                  onClick={() => stagePose(staged ? null : pose.id)}
                  title={staged ? 'Unstage — back to the live scratch' : 'Stage for preview (gizmo grabs adopt it) — drag onto the clip strip to key it'}
                  className={
                    'flex cursor-grab items-center gap-1 rounded-md border px-1.5 py-1 active:cursor-grabbing ' +
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
                    onClick={(e) => { e.stopPropagation(); mirrorPose(pose.id) }}
                    title={`Mirror ${pose.name} across X into a new pose (left/right swap)`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-violet-300"
                  >
                    <FlipHorizontal2 size={12} />
                  </button>
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
    </section>
  )
}

/**
 * Clip timelines (one exported action each): picker with add/rename/delete, loop toggle,
 * duration, transport, a key strip (markers by time, draggable playhead to scrub,
 * draggable markers to retime snapped to 1/30 s, first key locked at 0), and the
 * selected key's inspector. "+ key" keys the staged pose (else the editing target) at
 * the playhead, else half a second past the last key.
 */
function ClipsSection() {
  const clips = useAppStore((s) => s.clips)
  const activeClipId = useAppStore((s) => s.activeClipId)
  const selectedKeyId = useAppStore((s) => s.selectedKeyId)
  const clipPlaying = useAppStore((s) => s.clipPlaying)
  const clipTime = useAppStore((s) => s.clipTime)
  const poses = useAppStore((s) => s.poses)
  const stagedPoseId = useAppStore((s) => s.stagedPoseId)
  const editingPoseId = useAppStore((s) => s.editingPoseId)
  const addClip = useAppStore((s) => s.addClip)
  const renameClip = useAppStore((s) => s.renameClip)
  const deleteClip = useAppStore((s) => s.deleteClip)
  const patchClip = useAppStore((s) => s.patchClip)
  const setActiveClip = useAppStore((s) => s.setActiveClip)
  const setClipPlaying = useAppStore((s) => s.setClipPlaying)
  const addKey = useAppStore((s) => s.addKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const clip = clips.find((c) => c.id === activeClipId) ?? null

  function commitRename() {
    if (clip && draft.trim()) renameClip(clip.id, draft)
    setEditing(false)
    setDraft('')
  }

  // "+ key" keys the staged pose, else the pose under edit — never a surprise pick.
  const keyPoseId = stagedPoseId ?? editingPoseId
  const keyPose = poses.find((p) => p.id === keyPoseId) ?? null
  const lastKeyTime = clip && clip.keys.length > 0 ? clip.keys[clip.keys.length - 1].time : 0
  const keyAt = clipTime ?? (clip && clip.keys.length > 0 ? lastKeyTime + 0.5 : 0)

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-neutral-800 px-2 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-neutral-500">Clip</span>
        <span className="min-w-0 flex-1" />
        <button
          onClick={() => addClip()}
          title="Add a new empty clip (1 s, looping)"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-neutral-800 hover:text-violet-100"
        >
          <Plus size={12} />
          add
        </button>
      </div>
      {clip ? (
        <>
          <div className="flex items-center gap-1.5">
            <select
              value={clip.id}
              onChange={(e) => setActiveClip(e.target.value)}
              title="Clip under edit"
              className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              {clips.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => deleteClip(clip.id)}
              title={`Delete ${clip.name}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
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
                className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            ) : (
              <button
                onDoubleClick={() => { setEditing(true); setDraft(clip.name) }}
                title="Double-click to rename (glTF-safe, uniquified)"
                className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-neutral-200"
              >
                {clip.name}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => patchClip(clip.id, { loop: !clip.loop })}
              title={clip.loop ? 'Looping: the last key eases back to the first' : 'One-shot: holds the last key past the end'}
              className={
                'flex h-5 items-center justify-center rounded px-1.5 text-[10px] font-medium transition ' +
                (clip.loop ? 'bg-violet-500/60 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
              }
            >
              {clip.loop ? 'Loop' : 'Once'}
            </button>
            <label className="flex items-center gap-1 text-[10px] text-neutral-500" title="Clip length in seconds (snapped to 1/30 s)">
              <input
                type="number"
                aria-label="Clip duration in seconds"
                min={0}
                step={1 / 30}
                value={clip.duration}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) patchClip(clip.id, { duration: v })
                }}
                className="w-16 rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              s
            </label>
            <span className="min-w-0 flex-1" />
            <button
              onClick={() => keyPose && addKey(clip.id, keyPose.id)}
              disabled={!keyPose}
              title={keyPose ? `Key ${keyPose.name} at ${keyAt.toFixed(2)}s` : 'Stage or capture a pose first — keys point at library poses'}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-neutral-800 hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Plus size={12} />
              key
            </button>
            <button
              onClick={() => setClipPlaying(!clipPlaying)}
              title={clipPlaying ? 'Pause (freezes the playhead where it stops)' : 'Play the clip'}
              className="flex h-5 w-5 items-center justify-center rounded text-violet-300 hover:bg-neutral-800 hover:text-violet-100"
            >
              {clipPlaying ? <Pause size={12} /> : <Play size={12} />}
            </button>
          </div>
          {clip.keys.length === 0 ? (
            <p className="text-[10px] leading-snug text-neutral-500">
              No keys yet — stage a pose below, then + key it in (or drag a pose onto the strip once keys exist).
            </p>
          ) : (
            <KeyStrip clip={clip} />
          )}
          {selectedKeyId && clip.keys.some((k) => k.id === selectedKeyId) && (
            <KeyInspector clip={clip} keyId={selectedKeyId} />
          )}
        </>
      ) : (
        <p className="text-[10px] leading-snug text-neutral-500">
          No clips yet — add one to key poses on a timeline.
        </p>
      )}
    </div>
  )
}

/**
 * The clip's timeline: a horizontal track mapping 0..duration to its width, with a
 * marker per key and a playhead (paused/scrubbed time, else the selected key's time).
 * Dragging empty track scrubs (pausing first, snapped to 1/30 s); dragging a marker
 * retimes it as one undo stroke (pointer-captured, first key locked at 0); clicking a
 * marker seeks there and stages its pose for gizmo editing. Library rows drop onto it
 * to key that pose at the drop time.
 */
function KeyStrip({ clip }: { clip: RigClip }) {
  const clipTime = useAppStore((s) => s.clipTime)
  const clipPlaying = useAppStore((s) => s.clipPlaying)
  const selectedKeyId = useAppStore((s) => s.selectedKeyId)
  const poses = useAppStore((s) => s.poses)
  const setClipPlaying = useAppStore((s) => s.setClipPlaying)
  const setClipTime = useAppStore((s) => s.setClipTime)
  const setSelectedKey = useAppStore((s) => s.setSelectedKey)
  const stagePose = useAppStore((s) => s.stagePose)
  const addKey = useAppStore((s) => s.addKey)
  const patchKey = useAppStore((s) => s.patchKey)
  const animBeginStroke = useAppStore((s) => s.animBeginStroke)
  const animCommitStroke = useAppStore((s) => s.animCommitStroke)
  const trackRef = useRef<HTMLDivElement>(null)
  // Scrub gesture vs marker-retime gesture (markers stop-propagation, so only one runs).
  const scrubbing = useRef(false)
  // The retime drag clamps against the duration captured at pointer-down, so pushing a
  // key past the end can never grow the clip mid-drag and rescale the track under it.
  const retime = useRef<{ keyId: string; startX: number; startTime: number; moved: boolean; duration: number; loop: boolean } | null>(null)

  const duration = Math.max(clip.duration, 1 / 30)
  const selectedKey = clip.keys.find((k) => k.id === selectedKeyId) ?? null
  const playhead = clipTime ?? selectedKey?.time ?? null
  const lastKey = clip.keys[clip.keys.length - 1]

  function timeAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const t = (clientX - rect.left) / rect.width
    return Math.min(Math.max(t, 0), 1) * clip.duration
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          if (clipPlaying) setClipPlaying(false)
          scrubbing.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          setClipTime(timeAt(e.clientX))
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) setClipTime(timeAt(e.clientX))
        }}
        onPointerUp={() => { scrubbing.current = false }}
        onPointerCancel={() => { scrubbing.current = false }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-voxpaint-pose')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(e) => {
          const poseId = e.dataTransfer.getData('application/x-voxpaint-pose')
          if (!poseId || !poses.some((p) => p.id === poseId)) return
          e.preventDefault()
          addKey(clip.id, poseId, timeAt(e.clientX))
        }}
        title="Drag to scrub the playhead — drop a library pose to key it at that time"
        className="relative h-8 touch-none rounded bg-neutral-800/60"
      >
        {clip.loop && lastKey && lastKey.time < clip.duration && (
          <div
            title="Loop wrap: the last key eases back to the first across this span"
            className="absolute top-0 bottom-0 rounded-r bg-violet-500/10"
            style={{ left: `${(lastKey.time / duration) * 100}%`, right: 0 }}
          />
        )}
        {clip.keys.map((key, i) => {
          const locked = i === 0
          const selected = key.id === selectedKeyId
          return (
            <div
              key={key.id}
              onPointerDown={(e) => {
                e.stopPropagation()
                if (clipPlaying) setClipPlaying(false)
                e.currentTarget.setPointerCapture(e.pointerId)
                // Bracketed once per press so the whole retime drag lands in one undo entry;
                // a click without drag still opens and commits an empty stroke (a no-op).
                if (!locked) animBeginStroke()
                retime.current = { keyId: key.id, startX: e.clientX, startTime: key.time, moved: false, duration: clip.duration, loop: clip.loop }
              }}
              onPointerMove={(e) => {
                const drag = retime.current
                if (!drag || drag.keyId !== key.id || locked) return
                const rect = trackRef.current?.getBoundingClientRect()
                if (!rect || rect.width === 0) return
                if (Math.abs(e.clientX - drag.startX) > 3) drag.moved = true
                if (drag.moved) {
                  const raw = drag.startTime + ((e.clientX - drag.startX) / rect.width) * drag.duration
                  patchKey(clip.id, key.id, { time: clampKeyTime(raw, drag.duration, drag.loop) })
                }
              }}
              onPointerUp={(e) => {
                const drag = retime.current
                retime.current = null
                if (!locked) animCommitStroke()
                // A click (no drag) seeks the playhead there and stages the key's pose.
                if (drag && drag.keyId === key.id && !drag.moved) {
                  e.stopPropagation()
                  setSelectedKey(key.id)
                  stagePose(key.poseId)
                  setClipTime(key.time)
                }
              }}
              onPointerCancel={() => {
                retime.current = null
                if (!locked) animCommitStroke()
              }}
              title={locked ? 'First key — locked at 0 (click to select)' : `Key at ${key.time.toFixed(2)}s — drag to retime, click to select`}
              className={
                'absolute top-1/2 h-2.5 w-2.5 ' +
                (locked ? 'cursor-pointer' : 'cursor-ew-resize') +
                (selected ? ' bg-violet-300' : ' bg-neutral-400 hover:bg-neutral-200')
              }
              style={{ left: `${(key.time / duration) * 100}%`, transform: 'translate(-50%, -50%) rotate(45deg)' }}
            />
          )
        })}
        {playhead !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/80"
            style={{ left: `${(Math.min(Math.max(playhead, 0), clip.duration) / duration) * 100}%` }}
          />
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-neutral-500">
        <span>0.00</span>
        <span>{clip.duration.toFixed(2)}s</span>
      </div>
    </div>
  )
}

/** Inspector for the selected key: pose, time (seconds, 2 decimals, snapped on commit;
 * disabled for the first key locked at 0), ease, remove. */
function KeyInspector({ clip, keyId }: { clip: RigClip; keyId: string }) {
  const poses = useAppStore((s) => s.poses)
  const patchKey = useAppStore((s) => s.patchKey)
  const removeKey = useAppStore((s) => s.removeKey)
  const setSelectedKey = useAppStore((s) => s.setSelectedKey)

  const index = clip.keys.findIndex((k) => k.id === keyId)
  const key = index >= 0 ? clip.keys[index] : null
  if (!key) return null
  const locked = index === 0

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/5 px-1.5 py-1.5">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 text-[10px] font-medium text-neutral-300 select-none">
          Key {index + 1} of {clip.keys.length}
        </span>
        <button
          onClick={() => { removeKey(clip.id, key.id); setSelectedKey(null) }}
          title="Remove this key"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <label className="flex items-center gap-1.5" title="Key pose">
        <span className="w-8 shrink-0 text-[10px] text-neutral-500">Pose</span>
        <select
          value={key.poseId}
          onChange={(e) => patchKey(clip.id, key.id, { poseId: e.target.value })}
          className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          {poses.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5" title={locked ? 'First key is locked at 0' : 'Key time in seconds (snapped to 1/30 s on commit)'}>
        <span className="w-8 shrink-0 text-[10px] text-neutral-500">Time</span>
        <input
          key={`${key.id}:${key.time}`}
          type="number"
          aria-label="Key time in seconds"
          min={0}
          step={1 / 30}
          defaultValue={key.time.toFixed(2)}
          disabled={locked}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              (e.target as HTMLInputElement).value = key.time.toFixed(2)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onBlur={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) patchKey(clip.id, key.id, { time: v })
            else e.target.value = key.time.toFixed(2)
          }}
          className="w-20 rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-40"
        />
        <span className="text-[10px] text-neutral-500">s</span>
      </label>
      <div className="flex items-center gap-1.5" title="Easing out of this key toward the next (Hold freezes until then)">
        <span className="w-8 shrink-0 text-[10px] text-neutral-500">Ease</span>
        <div className="flex min-w-0 flex-1 gap-0.5" role="group" aria-label="Key easing">
          {(Object.entries(KEY_EASE_LABELS) as Array<[ClipKey['ease'], string]>).map(([ease, label]) => (
            <button
              key={ease}
              aria-pressed={key.ease === ease}
              onClick={() => patchKey(clip.id, key.id, { ease })}
              title={`${label} easing out of this key`}
              className={seg(key.ease === ease) + ' min-w-0 flex-1 px-0.5'}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Per-key easing presets: the curve out of a key toward the next (hold freezes until then). */
const KEY_EASE_LABELS: Record<ClipKey['ease'], string> = {
  linear: 'Linear',
  inOut: 'In-out',
  in: 'In',
  out: 'Out',
  hold: 'Hold',
}
