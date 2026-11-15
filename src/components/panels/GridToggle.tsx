import { Box, Boxes, Columns2, Grid2x2 } from 'lucide-react'
import { describeGridSplit, gridFamilyOf } from '@/engine/grid/subdiv'
import type { GridFamily } from '@/engine/grid/types'
import type { SplitAxis } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'

/**
 * Global edit-grid picker, always visible in model mode next to the voxel-kind toggle.
 * Four buttons — whole (default), halves, quarters, octal — set the resolution every edit
 * writes at: paint, erase, recolor, fill, select, and wand all address one grid cell, and
 * "whole" writes whole voxels (folding any detail under them). Clicking the active
 * half/quarter button advances its division globally (X → Y → Z; leave-X → leave-Y → leave-Z).
 */
function captionFor(family: GridFamily, split: SplitAxis[] | null): string {
  if (family === 'whole' || !split) return ''
  if (family === 'octal') return '8'
  return [...split].sort().join('').toUpperCase()
}

export function GridToggle() {
  const gridSplit = useAppStore((s) => s.gridSplit)
  const gridFamily = gridFamilyOf(gridSplit)
  const setGridDivision = useAppStore((s) => s.setGridDivision)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const disabled = useAppStore((s) => s.mode === 'texture' || s.mode === 'animate')

  const buttons = [
    { id: 'whole' as const, label: 'Whole voxels (1 cell)', Icon: Box },
    { id: 'half' as const, label: 'Halves (2 cells)', Icon: Columns2 },
    { id: 'quarter' as const, label: 'Quarters (4 cells)', Icon: Grid2x2 },
    { id: 'octal' as const, label: 'Full (8 cells)', Icon: Boxes },
  ]

  const hintFor = (id: GridFamily): string => {
    if (id === 'whole') return 'Edit whole voxels — painting over detail replaces it with one voxel'
    if (id === 'octal') return 'Edit in half-voxel cells (2×2×2) — every tool works at this resolution'
    const order = id === 'half' ? 'X → Y → Z' : 'leave-X → leave-Y → leave-Z'
    const armed = gridFamily === id ? describeGridSplit(gridSplit) : null
    return (
      `Edit in ${id === 'half' ? 'half' : 'quarter'}-voxel cells — every tool works at this resolution · ` +
      `click again to cycle ${order}${armed ? ` — now: ${armed}` : ''}`
    )
  }

  return (
    <>
      {buttons.map(({ id, label, Icon }) => {
        const active = gridFamily === id
        const caption = active ? captionFor(id, gridSplit) : ''
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={label}
            disabled={disabled}
            onPointerEnter={() => setStatusMessage(hintFor(id))}
            onPointerLeave={() => setStatusMessage(null)}
            onClick={() => {
              setGridDivision(id)
              // Status reflects the post-click division — read fresh after the set.
              const s = useAppStore.getState()
              setStatusMessage(`Grid: ${describeGridSplit(s.gridSplit)}`)
            }}
            className={
              'relative flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 ' +
              (active ? 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/25 hover:text-violet-200' : '')
            }
          >
            <Icon size={16} />
            {caption !== '' && (
              <span className="absolute bottom-0 right-0.5 text-[9px] font-semibold leading-none">{caption}</span>
            )}
          </button>
        )
      })}
    </>
  )
}

/**
 * Floating edit-grid panel: the left-hand twin of `ViewOptionsOverlay` (same frosted row, same
 * 32 px icon buttons, same top-3 inset), pinned top-left. Mounted by `Editor2D` while split and
 * by `Viewport3D` while the 2D pane is collapsed (`offsetForCompass` clears the compass there),
 * so exactly one is ever live. Model mode only.
 */
export function GridFloatingPanel({ offsetForCompass = false }: { offsetForCompass?: boolean }) {
  const show = useAppStore((s) => s.mode === 'model')
  if (!show) return null
  return (
    <div
      data-tour="grid"
      role="group"
      aria-label="Edit grid"
      className={
        'absolute top-3 z-40 flex items-center gap-1.5 rounded-xl border border-neutral-800 ' +
        'bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg ' +
        (offsetForCompass ? 'left-16' : 'left-3')
      }
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <GridToggle />
    </div>
  )
}
