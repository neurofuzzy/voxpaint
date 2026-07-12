import * as Tooltip from '@radix-ui/react-tooltip'
import { useAppStore } from '@/store/useAppStore'
import type { VoxelKind } from '@/store/types'
import { ChamferIcon, CubeIcon } from './voxelKindIcons'

const KINDS: Array<{ id: VoxelKind; label: string; Icon: typeof CubeIcon }> = [
  { id: 'cube', label: 'Cube', Icon: CubeIcon },
  { id: 'ramp', label: 'Chamfer', Icon: ChamferIcon },
]

/**
 * Which kind of voxel paint writes — cube vs. chamfer. Rendered as a bordered vertical segmented
 * toggle in the left toolbar (below the tools), so it reads clearly as a two-state switch. The
 * active segment is driven directly from `activeVoxelKind` (explicit classes rather than Radix
 * `data-state`, so the highlight is unambiguous behind the literal-fill SVG icons).
 */
export function VoxelKindToggle() {
  const activeVoxelKind = useAppStore((s) => s.activeVoxelKind)
  const setActiveVoxelKind = useAppStore((s) => s.setActiveVoxelKind)
  // Voxel kind (cube/chamfer) has no meaning while texturing — disabled in Texture mode.
  const disabled = useAppStore((s) => s.mode === 'texture')

  return (
    <Tooltip.Provider delayDuration={300}>
      <div
        role="group"
        aria-label="Voxel kind"
        aria-disabled={disabled}
        className={
          'flex flex-col divide-y divide-neutral-700 overflow-hidden rounded-lg border border-neutral-700 ' +
          (disabled ? 'pointer-events-none opacity-40' : '')
        }
      >
        {KINDS.map(({ id, label, Icon }) => {
          const active = activeVoxelKind === id
          return (
            <Tooltip.Root key={id}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => setActiveVoxelKind(id)}
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
                  {label} voxel
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
