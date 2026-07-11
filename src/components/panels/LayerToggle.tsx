import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { useAppStore } from '@/store/useAppStore'
import type { ActiveLayer } from '@/store/types'

export function LayerToggle({ compact = false }: { compact?: boolean }) {
  const activeLayer = useAppStore((s) => s.activeLayer)
  const setActiveLayer = useAppStore((s) => s.setActiveLayer)

  const root = (
    <ToggleGroup.Root
      type="single"
      value={activeLayer}
      onValueChange={(v) => v && setActiveLayer(v as ActiveLayer)}
      className="flex overflow-hidden rounded-full border border-neutral-700"
    >
      <ToggleGroup.Item
        value="color"
        className={
          compact
            ? 'px-2.5 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300'
            : 'flex-1 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300'
        }
      >
        Color
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="chamfer"
        className={
          compact
            ? 'px-2.5 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300'
            : 'flex-1 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300'
        }
      >
        Chamfer
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  )

  if (compact) return root

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">Paint layer</div>
      {root}
    </div>
  )
}
