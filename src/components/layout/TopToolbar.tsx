import { FileMenu } from '@/components/panels/FileMenu'
import { FullscreenToggle } from '@/components/panels/FullscreenToggle'
import { UndoRedoControls } from '@/components/panels/UndoRedoControls'

export function TopToolbar() {
  return (
    <div className="flex h-11 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-2">
      <span className="px-1 text-sm font-semibold tracking-tight text-neutral-100">VoxPaint</span>
      <FileMenu />
      <div className="h-5 w-px bg-neutral-800" />
      <UndoRedoControls />
      <div className="flex-1" />
      <FullscreenToggle />
    </div>
  )
}
