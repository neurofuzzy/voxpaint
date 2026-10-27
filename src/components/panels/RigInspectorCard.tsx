import { useEffect, useState } from 'react'
import { Bone, Crosshair } from 'lucide-react'
import { rigPivotOf } from '@/engine/rigging/types'
import { useAppStore } from '@/store/useAppStore'
import type { PaletteOrientation } from './FloatingPalette'

/**
 * Animate-mode floating panel content: an inspector for the selected rig box (the mode's
 * primary object). Shows identity (name, dims), rotation center (with reset), and outline
 * position (parent/children) — everything else lives in the outline, toolbar, and viewport.
 * Slice-loop authoring used to live here (`AnimationPalette`, deleted); slice loops from old
 * files still play back, they just can't be authored anymore.
 */
export function RigInspectorCard({ orientation = 'horizontal' }: { orientation?: PaletteOrientation } = {}) {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const renameRigBox = useAppStore((s) => s.renameRigBox)
  const setRigPivot = useAppStore((s) => s.setRigPivot)
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
                  <span className="whitespace-nowrap font-mono text-[10px] text-neutral-400" title={custom ? 'Rotation-center override (half-integers sit on cell boundaries — alt-click with the Pivot tool to pin a joint face)' : 'Rotates about the box center'}>
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
        </>
      )}
    </div>
  )
}
