import { ToolPalette } from '@/components/panels/ToolPalette'

export function LeftPanel() {
  return (
    <div className="flex w-14 flex-col border-r border-neutral-800 bg-neutral-900">
      <ToolPalette />
    </div>
  )
}
