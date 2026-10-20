import { Editor2D } from '@/components/editor2d/Editor2D'
import { PlaneEdgeSlider } from '@/components/editor2d/PlaneEdgeSlider'
import { useKeyboardShortcuts } from '@/components/editor2d/useKeyboardShortcuts'
import { Viewport3D } from '@/components/viewport3d/Viewport3D'
import { useAppStore } from '@/store/useAppStore'
import { BottomBar } from './BottomBar'
import { CollapsedRail } from './CollapsedRail'
import { LeftPanel } from './LeftPanel'
import { TopToolbar } from './TopToolbar'

export function MainLayout() {
  // The plane slider lives here (not in Editor2D) so it pins to the window's far right edge,
  // over the 3D viewport — texture mode has no construction plane, so it hides there.
  // It stays mounted in 3D-only mode: the plane still drives empty-space paint + slab facing.
  const showPlaneSlider = useAppStore((s) => s.mode !== 'texture')
  const collapsed = useAppStore((s) => s.layoutMode === '3d-only')
  // Global shortcuts live here (not in the 2D canvases) so they stay active when the 2D pane
  // is collapsed. The canvases must not call this hook themselves.
  useKeyboardShortcuts()

  function collapseEditor() {
    useAppStore.getState().setLayoutMode('3d-only')
  }

  function expandEditor() {
    useAppStore.getState().setLayoutMode('split')
  }

  return (
    <div className="flex h-full flex-col">
      <TopToolbar />
      <div className="relative flex min-h-0 flex-1">
        <LeftPanel />
        {collapsed ? (
          <>
            <CollapsedRail onExpand={expandEditor} />
            <div className="min-w-0 flex-1 overflow-hidden">
              <Viewport3D />
            </div>
          </>
        ) : (
          <div className="grid min-w-0 flex-1 grid-cols-2 grid-rows-1 overflow-hidden">
            <Editor2D onCollapse={collapseEditor} />
            <Viewport3D />
          </div>
        )}
        {showPlaneSlider && <PlaneEdgeSlider />}
      </div>
      <BottomBar />
    </div>
  )
}
