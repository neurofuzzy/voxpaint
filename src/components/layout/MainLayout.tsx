import { Editor2D } from '@/components/editor2d/Editor2D'
import { PlaneEdgeSlider } from '@/components/editor2d/PlaneEdgeSlider'
import { Viewport3D } from '@/components/viewport3d/Viewport3D'
import { useAppStore } from '@/store/useAppStore'
import { BottomBar } from './BottomBar'
import { LeftPanel } from './LeftPanel'
import { TopToolbar } from './TopToolbar'

export function MainLayout() {
  // The plane slider lives here (not in Editor2D) so it pins to the window's far right edge,
  // over the 3D viewport — texture mode has no construction plane, so it hides there.
  const showPlaneSlider = useAppStore((s) => s.mode !== 'texture')
  return (
    <div className="flex h-full flex-col">
      <TopToolbar />
      <div className="relative flex min-h-0 flex-1">
        <LeftPanel />
        <div className="grid min-w-0 flex-1 grid-cols-2 grid-rows-1 overflow-hidden">
          <Editor2D />
          <Viewport3D />
        </div>
        {showPlaneSlider && <PlaneEdgeSlider />}
      </div>
      <BottomBar />
    </div>
  )
}
