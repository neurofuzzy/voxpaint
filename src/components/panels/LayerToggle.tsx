import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { useAppStore } from '@/store/useAppStore'
import type { VoxelKind } from '@/store/types'

export function VoxelKindToggle({ compact = false }: { compact?: boolean }) {
  const activeVoxelKind = useAppStore((s) => s.activeVoxelKind)
  const setActiveVoxelKind = useAppStore((s) => s.setActiveVoxelKind)

  const root = (
    <ToggleGroup.Root
      type="single"
      value={activeVoxelKind}
      onValueChange={(v) => v && setActiveVoxelKind(v as VoxelKind)}
      className="flex overflow-hidden rounded-full border border-neutral-700"
    >
      <ToggleGroup.Item
        value="cube"
        className={
          compact
            ? 'px-2.5 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300'
            : 'flex-1 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300'
        }
      >
        Cube
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="ramp"
        className={
          compact
            ? 'px-2.5 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300'
            : 'flex-1 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300'
        }
      >
        Ramp
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  )

  if (compact) return root

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">Voxel kind</div>
      {root}
    </div>
  )
}
