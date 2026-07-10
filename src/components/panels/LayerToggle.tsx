import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { useAppStore } from '@/store/useAppStore'
import type { ActiveLayer } from '@/store/types'

export function LayerToggle() {
  const activeLayer = useAppStore((s) => s.activeLayer)
  const setActiveLayer = useAppStore((s) => s.setActiveLayer)

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">Paint layer</div>
      <ToggleGroup.Root
        type="single"
        value={activeLayer}
        onValueChange={(v) => v && setActiveLayer(v as ActiveLayer)}
        className="flex overflow-hidden rounded-md border border-neutral-800"
      >
        <ToggleGroup.Item
          value="color"
          className="flex-1 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300"
        >
          Color
        </ToggleGroup.Item>
        <ToggleGroup.Item
          value="chamfer"
          className="flex-1 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300"
        >
          Chamfer
        </ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
  )
}
