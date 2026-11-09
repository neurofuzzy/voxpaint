import { useMemo, useRef, useState } from 'react'
import { Bone, ChevronDown, ChevronRight, ChevronUp, Copy, Crosshair, Eye, EyeOff, FlipHorizontal2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { Axis, Coord } from '@/engine/grid/types'
import { SLIDE_AMOUNT_MAX, SLIDE_AMOUNT_MIN } from '@/engine/animation/animationLayers'
import type { ClipKey, RigBox, RigClip, RigTween } from '@/engine/rigging/types'
import { normalizeFps, PENDULUM_TWEEN_ANGLE_MAX, PENDULUM_TWEEN_ANGLE_MIN } from '@/engine/rigging/types'
import { activeTweens } from '@/engine/rigging/rigLoop'
import type { JointEuler } from '@/engine/rigging/pose'
import { rigPivotOf, rigSubtreeIds } from '@/engine/rigging/types'
import type { AnimationSpeed } from '@/engine/animation/types'
import type { AnimateTab } from '@/store/types'
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
 * tweens land on the selection), and Motion (the selected keyframe's inspector card —
 * the pose IS the keyframe — no staging, every edit lands in the selected key. The
 * timeline itself docks
 * above the status bar, see TimelineDock). The focused tab drives the
 * contextual toolbar next to it, so taps always dispatch somewhere sensible. Only
 * one motion tab shows per project: Rig + Tweens for machines, Rig + Poses for
 * characters (see the mode toggle). Tweens are looping procedural motions that
 * evaluate simultaneously, composing top-first — stack order is motion order
 * (rotations don't commute), so rows reorder.
 */
const TABS: Array<{ id: AnimateTab; label: string }> = [
  { id: 'rig', label: 'Rig' },
  { id: 'tweens', label: 'Tweens' },
  { id: 'poses', label: 'Motion' },
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
      <div className="flex shrink-0 gap-1 border-b border-neutral-800 px-2" role="tablist" aria-label="Animate panel tabs">
        {tabs.map(({ id, label }) => {
          const active = tab === id
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              title={id === 'rig' ? 'Rig outline and selected-box properties' : animationMode === 'tweens' ? 'Tween motion stacks' : 'Animations and the selected keyframe'}
              className={
                'relative px-3 pb-2 pt-2.5 text-xs font-medium transition ' +
                (active ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-200')
              }
            >
              {label}
              {active && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-violet-400" />}
            </button>
          )
        })}
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
        <p className="rounded-md border border-dashed border-neutral-800 px-2 py-3 text-center text-[11px] text-neutral-500">
          No rig boxes yet — tap the model with the Rig tool to box a region.
          <span className="mt-1 block text-[10px]">
            Machine or Character is a project setting (gear icon, top bar).
          </span>
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

/** Per-key easing presets: the curve out of a key toward the next (hold freezes until then). */
const TWEEN_KIND_LABEL: Record<RigTween['kind'], string> = { rotate: 'Spin', pendulum: 'Pendulum', slide: 'Shuttle' }
const TWEEN_KIND_HINT: Record<RigTween['kind'], string> = {
  rotate: 'Turntable spin, full turn per cycle',
  pendulum: 'Swing between min/max angles, sine back and forth',
  slide: 'Axial shuttle, sine back and forth',
}

/** Direction dropdown options per tween kind (slide labels follow the axis). */
function directionOptions(tween: RigTween): Array<{ value: 1 | -1; label: string }> {
  if (tween.kind === 'pendulum') return [{ value: 1, label: 'min→max' }, { value: -1, label: 'max→min' }]
  if (tween.kind === 'slide') {
    return [
      { value: 1, label: `+${tween.axis.toUpperCase()}` },
      { value: -1, label: `−${tween.axis.toUpperCase()}` },
    ]
  }
  return [{ value: 1, label: 'Counter-clockwise' }, { value: -1, label: 'Clockwise' }]
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
          <select
            aria-label="Tween type"
            value={tween.kind}
            onChange={(e) => patchTween(boxId, tween.id, { kind: e.target.value as RigTween['kind'] })}
            title={TWEEN_KIND_HINT[tween.kind]}
            className="w-full rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {(Object.keys(TWEEN_KIND_LABEL) as Array<RigTween['kind']>).map((kind) => (
              <option key={kind} value={kind}>
                {TWEEN_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500">Axis</span>
          <select
            aria-label="Tween axis"
            value={tween.axis}
            onChange={(e) => patchTween(boxId, tween.id, { axis: e.target.value as Axis })}
            title={`${TWEEN_KIND_LABEL[tween.kind]} ${tween.kind === 'slide' ? 'along' : 'about'} an axis`}
            className="w-full rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] uppercase text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {(['x', 'y', 'z'] as Axis[]).map((axis) => (
              <option key={axis} value={axis}>
                {axis.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500">Direction</span>
          <select
            aria-label="Tween direction"
            value={tween.direction}
            onChange={(e) => patchTween(boxId, tween.id, { direction: Number(e.target.value) as 1 | -1 })}
            title="Which way the motion runs"
            className="w-full rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {directionOptions(tween).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500">Speed</span>
          <select
            aria-label="Cycle speed"
            value={tween.speed}
            onChange={(e) => patchTween(boxId, tween.id, { speed: Number(e.target.value) as AnimationSpeed })}
            title={`Cycle speed ${tween.speed}x`}
            className="w-full rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {([1, 2, 3] as AnimationSpeed[]).map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
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

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180
const AXIS_LABEL: Array<'X' | 'Y' | 'Z'> = ['X', 'Y', 'Z']
const AXIS_TEXT = ['text-red-400', 'text-green-400', 'text-blue-400']

/**
 * The selected joint's angle editor: name, per-axis degrees (sliders + numerics, colors
 * matched to the gizmo rings), and a per-joint reset. Lives inside the keyframe card —
 * the block always belongs to the thing it edits. While the transport plays the rows
 * hide behind a pause hint (no stable number without per-frame ticks); reset still
 * works (it pauses and lands on the target first).
 */
function JointBlock({ boxName, euler, playing, onSetAxis, onReset }: {
  boxName: string | null
  euler: JointEuler
  playing: boolean
  onSetAxis: (index: 0 | 1 | 2, deg: number) => void
  onReset: () => void
}) {
  const isBind = euler.every((v) => Math.abs(v) < 1e-3)
  if (!boxName) {
    return (
      <p className="text-[10px] leading-snug text-neutral-500">
        Select a joint in the Rig outline (or tap its footprint in 2D) — its angles land here.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-[10px] text-neutral-500 select-none">Joint</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-neutral-100" title={boxName}>
          {boxName}
        </span>
        <button
          onClick={onReset}
          disabled={!playing && isBind}
          title={isBind && !playing ? `${boxName} is at bind` : `Reset ${boxName} to bind`}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-neutral-800 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <RotateCcw size={12} />
          reset
        </button>
      </div>
      {playing ? (
        <p className="text-[10px] leading-snug text-neutral-500">
          Playing — pause to inspect live angles. Reset pauses and clears this joint.
        </p>
      ) : (
        ([0, 1, 2] as const).map((i) => {
          const deg = euler[i] * RAD2DEG
          return (
            <label key={i} className="flex items-center gap-1.5" title={`${AXIS_LABEL[i]} rotation in degrees`}>
              <span className={`w-3 shrink-0 font-mono text-[10px] font-semibold ${AXIS_TEXT[i]}`}>{AXIS_LABEL[i]}</span>
              <input
                type="range"
                aria-label={`${boxName} ${AXIS_LABEL[i]} rotation in degrees`}
                min={-180}
                max={180}
                step={1}
                value={Math.min(Math.max(deg, -180), 180)}
                onChange={(e) => onSetAxis(i, Number(e.target.value))}
                className="h-4 min-w-0 flex-1 accent-violet-500"
              />
              <input
                key={`${boxName}:${i}:${Math.round(deg * 10)}`}
                type="number"
                aria-label={`${boxName} ${AXIS_LABEL[i]} rotation value`}
                min={-180}
                max={180}
                step={1}
                defaultValue={deg.toFixed(1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') {
                    (e.target as HTMLInputElement).value = deg.toFixed(1)
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) onSetAxis(i, v)
                  else e.target.value = deg.toFixed(1)
                }}
                className="w-16 shrink-0 rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <span className="w-3 shrink-0 text-[10px] text-neutral-500">°</span>
            </label>
          )
        })
      )}
    </div>
  )
}

/**
 * The selected root's offset editor: x/y/z steppers in voxels (0.25 step, ±8 — a
 * walk-cycle bob or idle sway), plus a zero-out reset. Roots only: offsets never
 * evaluate on children, so the block hides there (the joint block above still shows).
 * While the transport plays the rows hide behind a pause hint; reset still works
 * (it pauses and lands on the target first).
 */
const OFFSET_STEP = 0.25
const OFFSET_MIN = -8
const OFFSET_MAX = 8

function OffsetBlock({ boxName, offset, playing, onSetAxis, onReset }: {
  boxName: string
  offset: Coord
  playing: boolean
  onSetAxis: (index: 0 | 1 | 2, v: number) => void
  onReset: () => void
}) {
  const isZero = offset.every((v) => Math.abs(v) < 1e-9)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-[10px] text-neutral-500 select-none">Offset</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-neutral-100" title={boxName}>
          {boxName}
        </span>
        <button
          onClick={onReset}
          disabled={!playing && isZero}
          title={isZero && !playing ? `${boxName} offset is zero` : `Zero out ${boxName}'s offset`}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-neutral-800 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <RotateCcw size={12} />
          zero
        </button>
      </div>
      {playing ? (
        <p className="text-[10px] leading-snug text-neutral-500">
          Playing — pause to inspect live offsets. Zeroing pauses and clears this offset.
        </p>
      ) : (
        ([0, 1, 2] as const).map((i) => (
          <label key={i} className="flex items-center gap-1.5" title={`${AXIS_LABEL[i]} offset in voxels`}>
            <span className={`w-3 shrink-0 font-mono text-[10px] font-semibold ${AXIS_TEXT[i]}`}>{AXIS_LABEL[i]}</span>
            <input
              type="range"
              aria-label={`${boxName} ${AXIS_LABEL[i]} offset in voxels`}
              min={OFFSET_MIN}
              max={OFFSET_MAX}
              step={OFFSET_STEP}
              value={Math.min(Math.max(offset[i], OFFSET_MIN), OFFSET_MAX)}
              onChange={(e) => onSetAxis(i, Number(e.target.value))}
              className="h-4 min-w-0 flex-1 accent-violet-500"
            />
            <input
              key={`${boxName}:${i}:${Math.round(offset[i] / OFFSET_STEP)}`}
              type="number"
              aria-label={`${boxName} ${AXIS_LABEL[i]} offset value`}
              min={OFFSET_MIN}
              max={OFFSET_MAX}
              step={OFFSET_STEP}
              defaultValue={offset[i].toFixed(2)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  (e.target as HTMLInputElement).value = offset[i].toFixed(2)
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) onSetAxis(i, v)
                else e.target.value = offset[i].toFixed(2)
              }}
              className="w-16 shrink-0 rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <span className="w-6 shrink-0 text-[10px] text-neutral-500">vx</span>
          </label>
        ))
      )}
    </div>
  )
}

/**
 * The selected keyframe: name, time, ease, per-key actions (mirror, duplicate, reset,
 * delete), and the joint block for the selected rig box (edits land directly in the
 * key — the pose is the keyframe). The playhead note covers the one indirect case:
 * scrubbed elsewhere, an edit pauses and jumps the playhead onto this key first.
 */
function KeyframeCard({ clip, keyId }: { clip: RigClip; keyId: string }) {
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const clipPlaying = useAppStore((s) => s.clipPlaying)
  const clipTime = useAppStore((s) => s.clipTime)
  const fps = useAppStore((s) => normalizeFps(s.meta.fps))
  const patchKey = useAppStore((s) => s.patchKey)
  const removeKey = useAppStore((s) => s.removeKey)
  const duplicateKey = useAppStore((s) => s.duplicateKey)
  const mirrorKey = useAppStore((s) => s.mirrorKey)
  const resetKey = useAppStore((s) => s.resetKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const index = clip.keys.findIndex((k) => k.id === keyId)
  const key = index >= 0 ? clip.keys[index] : null
  if (!key) return null
  const locked = index === 0
  const joints = Object.keys(key.joints).length
  const offsets = Object.keys(key.offsets ?? {}).length

  function commitRename() {
    if (draft.trim()) patchKey(clip.id, key!.id, { name: draft })
    setEditing(false)
    setDraft('')
  }

  const box = rigBoxes.find((b) => b.id === selectedRigBoxId) ?? null
  const euler: JointEuler = box ? (key.joints[box.id] ?? [0, 0, 0]) : [0, 0, 0]
  // Offsets are roots-only (children ride their parent's chain) — the offset block
  // only shows on roots, matching the translate gizmo.
  const isRoot = box !== null && box.parentId === null
  const offset: Coord = box && key.offsets?.[box.id] ? [...key.offsets[box.id]] as Coord : [0, 0, 0]
  // Scrubbed elsewhere: the viewport shows the playhead frame, but an edit pauses and
  // jumps onto this key — say so, so the jump never surprises.
  const away = !clipPlaying && clipTime !== null && clipTime !== key.time

  function editJoint(jointId: string, build: (base: JointEuler) => JointEuler) {
    const st = useAppStore.getState()
    // Claim the viewport first: pause transport and re-seek the playhead onto this key,
    // so the card always edits the pose on screen — matching the gizmo grab routing.
    st.setClipPlaying(false)
    st.setClipTime(key!.time)
    const base = key!.joints[jointId] ?? [0, 0, 0]
    st.setKeyJoint(clip.id, key!.id, jointId, build(base))
  }

  function setAxis(jointId: string, i: 0 | 1 | 2, deg: number) {
    if (!Number.isFinite(deg) || useAppStore.getState().clipPlaying) return
    editJoint(jointId, (base) => {
      const next: JointEuler = [base[0], base[1], base[2]]
      next[i] = Math.min(Math.max(deg, -180), 180) * DEG2RAD
      return next
    })
  }

  function editOffset(jointId: string, build: (base: Coord) => Coord) {
    const st = useAppStore.getState()
    // Same claim-the-viewport routing as joints: pause and re-seek onto this key.
    st.setClipPlaying(false)
    st.setClipTime(key!.time)
    const base = key!.offsets?.[jointId] ?? [0, 0, 0]
    st.setKeyOffset(clip.id, key!.id, jointId, build(base))
  }

  function setOffsetAxis(jointId: string, i: 0 | 1 | 2, v: number) {
    if (!Number.isFinite(v) || useAppStore.getState().clipPlaying) return
    editOffset(jointId, (base) => {
      const next: Coord = [base[0], base[1], base[2]]
      next[i] = Math.min(Math.max(v, OFFSET_MIN), OFFSET_MAX)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 select-none">
          Keyframe
        </span>
        <button
          onClick={() => mirrorKey(clip.id, key.id)}
          title="Mirror this keyframe's pose across X in place (left/right swap)"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-violet-300"
        >
          <FlipHorizontal2 size={12} />
        </button>
        <button
          onClick={() => duplicateKey(clip.id, key.id)}
          title="Duplicate this keyframe (same pose, one frame later)"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={() => resetKey(clip.id, key.id)}
          title="Reset this keyframe to bind (clears every joint and offset)"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-300 hover:bg-neutral-800 hover:text-amber-100"
        >
          <RotateCcw size={12} />
        </button>
        <button
          onClick={() => removeKey(clip.id, key.id)}
          disabled={locked}
          title={locked ? 'The frame-1 key is locked — reset it to bind instead of deleting it' : 'Remove this key'}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 text-[10px] font-medium text-neutral-300 select-none">
          Key {index + 1} of {clip.keys.length}{locked ? ' · frame 1 (locked)' : ''} · {joints} joint{joints === 1 ? '' : 's'}{offsets > 0 ? ` · ${offsets} offset${offsets === 1 ? '' : 's'}` : ''}
        </span>
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
            onDoubleClick={() => { setEditing(true); setDraft(key.name) }}
                title="Double-click to rename (uniquified within the animation)"
            className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-neutral-200"
          >
            {key.name}
          </button>
        )}
      </div>
      <label className="flex items-center gap-1.5" title={locked ? 'First key is locked at 0' : `Key time in seconds (snapped to 1/${fps} s on commit)`}>
        <span className="w-8 shrink-0 text-[10px] text-neutral-500">Time</span>
        <input
          key={`${key.id}:${key.time}`}
          type="number"
          aria-label="Key time in seconds"
          min={0}
          step={1 / fps}
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
      <label className="flex items-center gap-1.5" title="Easing out of this key toward the next (Hold freezes until then)">
        <span className="w-8 shrink-0 text-[10px] text-neutral-500">Ease</span>
        <select
          aria-label="Key easing"
          value={key.ease}
          onChange={(e) => patchKey(clip.id, key.id, { ease: e.target.value as ClipKey['ease'] })}
          className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          {(Object.entries(KEY_EASE_LABELS) as Array<[ClipKey['ease'], string]>).map(([ease, label]) => (
            <option key={ease} value={ease}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="-mx-3 border-t border-neutral-800" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 select-none">
        Joint
      </span>
      <JointBlock
        boxName={box?.name ?? null}
        euler={euler}
        playing={clipPlaying}
        onSetAxis={(i, deg) => box && setAxis(box.id, i, deg)}
        onReset={() => box && editJoint(box.id, () => [0, 0, 0])}
      />
      {isRoot && box && (
        <OffsetBlock
          boxName={box.name}
          offset={offset}
          playing={clipPlaying}
          onSetAxis={(i, v) => setOffsetAxis(box.id, i, v)}
          onReset={() => editOffset(box.id, () => [0, 0, 0])}
        />
      )}
      {away && (
        <p className="text-[10px] leading-snug text-neutral-500">
          Playhead is elsewhere — editing jumps onto this key.
        </p>
      )}
    </div>
  )
}

/**
 * No keyframe selected (or no animation active): the joint card has nothing to edit.
 * Points at the timeline — clips always open with their frame-1 key selected, so this
 * only shows for a deselected strip.
 */
function NoKeyframeCard() {
  return (
    <div className="flex flex-col gap-1.5 px-0 py-1">
      <span className="text-[11px] font-medium text-neutral-300 select-none">
        No keyframe selected
      </span>
      <p className="text-[10px] leading-snug text-neutral-500">
        Pick a diamond on the timeline below — joint angles land in the selected key.
      </p>
    </div>
  )
}

/**
 * Side-panel poses: the thing under edit — the selected keyframe's card (name, time,
 * ease, joint block), or a pointer at the timeline when nothing is selected. Time
 * itself lives in the bottom-docked TimelineDock; this panel never duplicates it.
 */
/**
 * Every animation in the project, managed here: pick one to load it into the
 * timeline below the views (the timeline always keys to the selection), rename it
 * (double-click — the name becomes the exported action), delete it, or add a new
 * one. Loop and duration live on the selected animation.
 */
function AnimationsSection() {
  const clips = useAppStore((s) => s.clips)
  const activeClipId = useAppStore((s) => s.activeClipId)
  const fps = useAppStore((s) => normalizeFps(s.meta.fps))
  const addClip = useAppStore((s) => s.addClip)
  const renameClip = useAppStore((s) => s.renameClip)
  const deleteClip = useAppStore((s) => s.deleteClip)
  const patchClip = useAppStore((s) => s.patchClip)
  const setActiveClip = useAppStore((s) => s.setActiveClip)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function commitRename(id: string) {
    if (draft.trim()) renameClip(id, draft)
    setEditingId(null)
    setDraft('')
  }

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-neutral-400 select-none">
          Animations ({clips.length})
        </span>
        <button
          onClick={() => addClip()}
          title="Add a new animation (1 s, looping) — one per action: walk, idle, dodge"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-neutral-800 hover:text-violet-100"
        >
          <Plus size={12} />
          New
        </button>
      </div>
      {clips.length === 0 ? (
        <button
          onClick={() => addClip()}
          title="Create your first animation (1 s, looping) — one per action: walk, idle, dodge"
          className="flex flex-col gap-1 rounded-md border border-dashed border-neutral-800 px-2 py-3 text-center hover:border-violet-500/40 hover:bg-violet-500/5"
        >
          <span className="text-[11px] font-medium text-neutral-200">No animations yet</span>
          <span className="text-[10px] leading-snug text-neutral-500">
            Each animation is one action — walk, idle, dodge. Press to create the first.
          </span>
        </button>
      ) : (
        <ul className="flex flex-col gap-1">
          {clips.map((c) => {
            const active = c.id === activeClipId
            const frames = Math.max(1, Math.round(c.duration * fps))
            return (
              <li
                key={c.id}
                className={
                  'flex flex-col gap-1 rounded-md border px-1.5 py-1 ' +
                  (active ? 'border-violet-500/60 bg-violet-500/10' : 'border-neutral-800 hover:bg-neutral-800/60')
                }
              >
                <div
                  onClick={() => setActiveClip(active ? null : c.id)}
                  title={active ? 'Deselect — the timeline clears' : `Edit ${c.name} in the timeline below the views`}
                  className="flex cursor-pointer items-center gap-1 text-left"
                >
                  {editingId === c.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(c.id)
                        if (e.key === 'Escape') { setEditingId(null); setDraft('') }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      title="Animation name — becomes the exported action name"
                      className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  ) : (
                    <button
                      onDoubleClick={() => { setEditingId(c.id); setDraft(c.name) }}
                      title={`"${c.name}" — double-click to rename (becomes the exported action name)`}
                      className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-neutral-200"
                    >
                      {c.name}
                    </button>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-neutral-500">
                    {c.keys.length} key{c.keys.length === 1 ? '' : 's'} · {frames}f{c.loop ? '' : ' · once'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteClip(c.id) }}
                    title={`Delete ${c.name}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {active && (
                  <div className="flex items-center gap-1.5 border-t border-violet-500/20 pt-1.5">
                    <button
                      onClick={() => patchClip(c.id, { loop: !c.loop })}
                      title={c.loop ? 'Looping: the last key eases back to the first' : 'One-shot: holds the last key past the end'}
                      className={
                        'flex h-5 items-center justify-center rounded px-1.5 text-[10px] font-medium transition ' +
                        (c.loop ? 'bg-violet-500/60 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
                      }
                    >
                      {c.loop ? 'Loop' : 'Once'}
                    </button>
                    <label className="flex min-w-0 flex-1 items-center justify-end gap-1 text-[10px] text-neutral-500" title={`Animation length in whole frames at ${fps} fps (Project settings)`}>
                      {/* Uncontrolled + remounted on commit: clearing the field to retype (e.g.
                          60 → 20) never live-patches through the duration floor mid-keystroke. */}
                      <input
                        key={`${c.id}:${frames}`}
                        type="number"
                        aria-label="Animation length in frames"
                        min={1}
                        step={1}
                        defaultValue={frames}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') {
                            (e.target as HTMLInputElement).value = String(frames)
                            ;(e.target as HTMLInputElement).blur()
                          }
                        }}
                        onBlur={(e) => {
                          const f = Math.round(Number(e.target.value))
                          if (Number.isFinite(f) && f >= 1) patchClip(c.id, { duration: f / fps })
                          else e.target.value = String(frames)
                        }}
                        className="w-16 rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                      fr
                    </label>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function PosesSection() {
  const clips = useAppStore((s) => s.clips)
  const activeClipId = useAppStore((s) => s.activeClipId)
  const selectedKeyId = useAppStore((s) => s.selectedKeyId)

  const clip = clips.find((c) => c.id === activeClipId) ?? null
  const key = clip?.keys.find((k) => k.id === selectedKeyId) ?? null

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5">
      {/* Animations list scrolls on its own … */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimationsSection />
      </div>
      <div className="-mx-3 shrink-0 border-t border-neutral-800" />
      {/* … and the selected keyframe keeps its own panel below, never buried. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {clip && key ? <KeyframeCard clip={clip} keyId={key.id} /> : <NoKeyframeCard />}
      </div>
    </section>
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
