import { ToolPalette } from '@/components/panels/ToolPalette'
import { VoxelKindToggle } from '@/components/panels/LayerToggle'

export function LeftPanel() {
  return (
    <div className="flex w-14 flex-col border-r border-neutral-800 bg-neutral-900">
      <ToolPalette />
      <div className="mx-2 my-1 border-t border-neutral-800" />
      <div className="flex justify-center p-2">
        <VoxelKindToggle />
      </div>
    </div>
  )
}
