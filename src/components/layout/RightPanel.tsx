import { LayerToggle } from '@/components/panels/LayerToggle'
import { ModelStats } from '@/components/panels/ModelStats'
import { PaletteGrid } from '@/components/panels/PaletteGrid'

export function RightPanel() {
  return (
    <div className="flex w-64 flex-col border-l border-neutral-800 bg-neutral-900">
      <LayerToggle />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PaletteGrid />
      </div>
      <ModelStats />
    </div>
  )
}
