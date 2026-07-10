import { Editor2D } from '@/components/editor2d/Editor2D'
import { Viewport3D } from '@/components/viewport3d/Viewport3D'
import { LeftPanel } from './LeftPanel'
import { RightPanel } from './RightPanel'
import { TopToolbar } from './TopToolbar'

export function MainLayout() {
  return (
    <div className="flex h-full flex-col">
      <TopToolbar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <div className="grid min-w-0 flex-1 grid-cols-2">
          <Editor2D />
          <Viewport3D />
        </div>
        <RightPanel />
      </div>
    </div>
  )
}
