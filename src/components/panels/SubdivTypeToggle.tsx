import * as Tooltip from '@radix-ui/react-tooltip'
import { Box, Columns2, Grid2x2 } from 'lucide-react'
import { planeUVW, subdivFamiliesForPlane } from '@/engine/grid/subdiv'
import type { SplitAxis } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'

/**
 * Subdivision picker, shown in place of the voxel-kind toggle while the Subdivide tool is
 * active. Three families — halves (2 children), quarters (4), full 2×2×2 (8). The buttons
 * are stateless family pickers: tapping one arms that family for the next plain-voxel
 * split (always its first division — U, leave-U, full). Tapping an already-subdivided
 * voxel cycles it through its own family's divisions (U → V → W, then the quarter-planes,
 * then full) based purely on the voxel's state, merging back to whole past the end — the
 * buttons never track or change axes themselves.
 */
function describePending(split: SplitAxis[] | null, planeAxis: 'x' | 'y' | 'z'): string {
  if (!split) return 'whole voxels (no subdivision)'
  const { u, v } = planeUVW(planeAxis)
  const toUVW = (a: SplitAxis): string => (a === u ? 'U' : a === v ? 'V' : 'W')
  const letters = [...split].sort().map(toUVW).join('')
  const world = [...split].sort().join('').toUpperCase()
  if (split.length === 3) return 'full 2×2×2'
  if (split.length === 2) return `quarters in ${letters} (${world})`
  return `halves along ${letters} (${world})`
}

export function SubdivTypeToggle() {
  const pendingSplit = useAppStore((s) => s.pendingSplit)
  const setPendingSplit = useAppStore((s) => s.setPendingSplit)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const disabled = useAppStore((s) => s.mode === 'texture' || s.mode === 'animate')
  const planeAxis = useAppStore((s) => s.plane.axis)
  const fams = subdivFamiliesForPlane(planeAxis)

  const family: 'two' | 'four' | 'eight' | null =
    pendingSplit === null ? null : pendingSplit.length === 1 ? 'two' : pendingSplit.length === 2 ? 'four' : 'eight'

  /** Arms a family for the next plain-voxel split — always its first division (U, leave-U,
   * full). Stateless: no axis cycling, no whole toggle; subdivided voxels cycle on tap
   * from their own state. */
  const select = (id: 'two' | 'four' | 'eight') => {
    const next = id === 'two' ? [...fams.two[0]] : id === 'four' ? [...fams.four[0]] : [...fams.eight[0]]
    setPendingSplit(next)
    setStatusMessage(`Subdivide: ${describePending(next, planeAxis)} — tap a split voxel to cycle it · Alt+click always forces full`)
  }

  const buttons = [
    { id: 'two' as const, label: 'Halves (2 cells)', Icon: Columns2 },
    { id: 'four' as const, label: 'Quarters (4 cells)', Icon: Grid2x2 },
    { id: 'eight' as const, label: 'Full (8 cells)', Icon: Box },
  ]

  return (
    <Tooltip.Provider delayDuration={300}>
      <div
        role="group"
        aria-label="Subdivision type"
        aria-disabled={disabled}
        className={
          'flex flex-col divide-y divide-neutral-700 overflow-hidden rounded-lg border border-neutral-700 ' +
          (disabled ? 'pointer-events-none opacity-40' : '')
        }
      >
  {buttons.map(({ id, label, Icon }) => {
        const active = family === id
        const hint = id === 'eight'
          ? 'Split plain voxels into 8 half-cells · tap a split voxel to merge it back · Alt+click always forces full'
          : id === 'two'
            ? 'Split plain voxels into 2 halves · tap a split voxel to cycle U → V → W → whole · Alt+click always forces full'
            : 'Split plain voxels into 4 quarters · tap a split voxel to cycle the quarter-planes → whole · Alt+click always forces full'
          return (
            <Tooltip.Root key={id}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  disabled={disabled}
                  onPointerEnter={() => setStatusMessage(hint)}
                  onPointerLeave={() => setStatusMessage(null)}
                  onClick={() => select(id)}
                  className={
                    'flex h-9 w-9 items-center justify-center transition ' +
                    (active
                      ? 'bg-violet-500/70 opacity-100'
                      : 'opacity-50 hover:bg-neutral-800 hover:opacity-100')
                  }
                >
                  <Icon size={18} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={8} className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 shadow-lg">
                  {label}
                  <Tooltip.Arrow className="fill-neutral-800" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )
        })}
      </div>
    </Tooltip.Provider>
  )
}
