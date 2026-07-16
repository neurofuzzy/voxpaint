import { useAppStore } from '@/store/useAppStore'
import { ToolPalette } from '@/components/panels/ToolPalette'
import { VoxelKindToggle } from '@/components/panels/LayerToggle'

export function LeftPanel() {
  const mode = useAppStore((s) => s.mode)

  return (
    <div data-tour="tools" className="flex w-14 flex-col border-r border-neutral-800 bg-neutral-900">
      <ToolPalette />
      {mode !== 'animate' && (
        <>
          <div className="mx-2 my-1 border-t border-neutral-800" />
          <div className="flex justify-center p-2">
            <VoxelKindToggle />
          </div>
        </>
      )}
    </div>
  )
}
