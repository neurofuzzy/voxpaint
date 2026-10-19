import { Boxes, Grid3x3, SquareArrowOutDownLeft, Sun, Video } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

const BTN_BASE = 'flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
const BTN_ON = 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/25 hover:text-violet-200'

function ToggleButton({ on, onClick, label, children, onPointerEnter, onPointerLeave }: {
  on: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
  onPointerEnter?: React.PointerEventHandler<HTMLButtonElement>
  onPointerLeave?: React.PointerEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={`${BTN_BASE} ${on ? BTN_ON : ''}`}
    >
      {children}
    </button>
  )
}

/**
 * Frosted overlay pinned to the top-right of the 3D preview: view toggles (Wireframe, Texture
 * face map, Optimized mesh), camera reset, and exposure. The construction-plane pose (axis,
 * orientation, offset) lives on the far-right edge slider (`PlaneEdgeSlider`), along with the
 * 3D paint plane lock (3D-only model mode).
 * Collapsing the 2D pane lives on the 2D pane itself (its X button) and the collapsed rail.
 * `stopPropagation` keeps clicks/drags off the OrbitControls underneath.
 */
export function ViewOptionsOverlay({ onResetCamera, showExposure, onToggleExposure }: {
  onResetCamera: () => void
  showExposure: boolean
  onToggleExposure: () => void
}) {
  const mode = useAppStore((s) => s.mode)
  const wireframe = useAppStore((s) => s.wireframe)
  const textureFaceMap = useAppStore((s) => s.textureFaceMap)
  const optimizedMesh = useAppStore((s) => s.optimizedMesh)
  const setWireframe = useAppStore((s) => s.setWireframe)
  const setTextureFaceMap = useAppStore((s) => s.setTextureFaceMap)
  const setOptimizedMesh = useAppStore((s) => s.setOptimizedMesh)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  return (
    <div
      className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-xl border border-neutral-800
        bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <ToggleButton
        on={wireframe}
        onClick={() => setWireframe(!wireframe)}
        label="Wireframe"
        onPointerEnter={() => setStatusMessage('Toggle wireframe overlay on the 3D view')}
        onPointerLeave={() => setStatusMessage(null)}
      >
        <Grid3x3 size={16} />
      </ToggleButton>
      {mode === 'texture' && (
        <ToggleButton
          on={textureFaceMap}
          onClick={() => setTextureFaceMap(!textureFaceMap)}
          label="Texture face map"
          onPointerEnter={() => setStatusMessage('Highlight voxel faces mapped to the active texture face')}
          onPointerLeave={() => setStatusMessage(null)}
        >
          <SquareArrowOutDownLeft size={16} />
        </ToggleButton>
      )}
      <ToggleButton
        on={optimizedMesh}
        onClick={() => setOptimizedMesh(!optimizedMesh)}
        label="Optimized mesh"
        onPointerEnter={() => setStatusMessage('Toggle coplanar-face merge on the CSG shell')}
        onPointerLeave={() => setStatusMessage(null)}
      >
        <Boxes size={16} />
      </ToggleButton>

      <button
        onClick={onResetCamera}
        title="Reset camera"
        aria-label="Reset camera"
        onPointerEnter={() => setStatusMessage('Click to reset the camera to its default position')}
        onPointerLeave={() => setStatusMessage(null)}
        className={BTN_BASE}
      >
        <Video size={16} />
      </button>
      <ToggleButton
        on={showExposure}
        onClick={onToggleExposure}
        label="Exposure"
        onPointerEnter={() => setStatusMessage('Toggle the exposure slider')}
        onPointerLeave={() => setStatusMessage(null)}
      >
        <Sun size={16} />
      </ToggleButton>
    </div>
  )
}
