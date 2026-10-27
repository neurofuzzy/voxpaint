import { useMemo, useState } from 'react'
import { Bone, ChevronDown, ChevronRight, Crosshair, Trash2 } from 'lucide-react'
import type { RigBox } from '@/engine/rigging/types'
import { rigSubtreeIds } from '@/engine/rigging/types'
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
 * Animate-mode left-side rigging outline: the mirror of the right-side emissive
 * `SettingsPalette`. Lists named rig bounding boxes (wand-created, model-decoupled) as a
 * draggable tree — drop *between* rows to reorder, *onto* a row to nest as its child — for
 * GLTF export mesh naming, with rename/select/delete management. Rows also show each box's
 * rotation-center pivot (crosshair): click an unset one to arm the Pivot tool, click a set
 * one to reset it to the box center. Collapsible panel, same frosted styling and pointer
 * stop-propagation as the right panel.
 */
export function RiggingPalette() {
  const [minimized, setMinimized] = useState(true)
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const renameRigBox = useAppStore((s) => s.renameRigBox)
  const deleteRigBox = useAppStore((s) => s.deleteRigBox)
  const selectRigBox = useAppStore((s) => s.selectRigBox)
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

  if (minimized) {
    return (
      <div className="absolute bottom-4 left-3 z-40" onPointerDown={(e) => e.stopPropagation()}>
        <button
          onClick={() => setMinimized(false)}
          title="Rigging selections"
          className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-800
            bg-neutral-900/80 text-neutral-400 shadow-2xl backdrop-blur-lg hover:text-neutral-200"
        >
          <Bone size={16} />
          {rigBoxes.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-semibold text-white">
              {rigBoxes.length}
            </span>
          )}
        </button>
      </div>
    )
  }

  function commitRename(id: string) {
    if (draft.trim()) renameRigBox(id, draft)
    setEditingId(null)
    setDraft('')
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Drop zone within a row from the pointer height: top edge → before, bottom → after,
   * middle → nest as last child. Collapsed or childless rows still accept `child`. */
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
      // Reveal the new child when nesting under a collapsed parent.
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

  return (
    <div
      className="absolute bottom-4 left-3 z-40 flex w-60 flex-col gap-2 rounded-xl border border-neutral-800
        bg-neutral-900/80 p-3 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-300 select-none">
          Rigging ({rigBoxes.length})
        </span>
        <button
          onClick={() => setMinimized(true)}
          title="Minimize"
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:text-neutral-200"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <p className="text-[11px] leading-snug text-neutral-500">
        Tap the model with the Rig tool to box a region. Drag rows to reorder or nest — nested
        boxes export as child meshes. Select a box, then click with the Pivot tool to move its
        rotation center.
      </p>
      {rigBoxes.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-800 px-2 py-3 text-center text-[11px] text-neutral-500">
          No rig boxes yet
        </p>
      ) : (
        <ul
          className="flex max-h-56 flex-col overflow-y-auto pb-1"
          onDragOver={(e) => {
            // Gutter below the last row: append at root level.
            if ((e.target as HTMLElement).closest('li')) return
            e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (!(e.target as HTMLElement).closest('li')) commitDrop(null, 'after')
          }}
        >
          {rows.map(({ box, depth }) => {
            const dims = `${box.max[0] - box.min[0] + 1}×${box.max[1] - box.min[1] + 1}×${box.max[2] - box.min[2] + 1}`
            const active = box.id === selectedRigBoxId
            const kids = childCounts.get(box.id) ?? 0
            const isCollapsed = collapsed.has(box.id)
            const dropHere = drop?.id === box.id ? drop.position : null
            const dimmed = dragId !== null && !canDrop(box.id) && dragId !== box.id
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
                  <span className="shrink-0 font-mono text-[10px] text-neutral-500">{dims}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (box.pivot) {
                        setRigPivot(box.id, null)
                      } else {
                        // Arm the workflow: select the box so the Pivot tool targets it, and
                        // switch to that tool so the next canvas click lands the pivot.
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
    </div>
  )
}
