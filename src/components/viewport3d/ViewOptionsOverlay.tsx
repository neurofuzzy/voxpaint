import { Boxes, FlipHorizontal, Grid3x3, Video } from 'lucide-react'
import type { Axis } from '@/engine/grid/types'
import { useAppStore } from '@/store/useAppStore'
import type { OptimizedMeshStats } from './OptimizedMeshView'

const BTN_BASE = 'flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
const BTN_ON = 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/25 hover:text-violet-200'

const AXES: Axis[] = ['x', 'y', 'z']

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
 * Frosted overlay pinned to the top-right of the 3D preview. Two clusters, divider-separated:
 * construction-plane controls (cycle axis, flip orientation — offset is driven by shift+wheel / the
 * gizmo) and view toggles (Wireframe, Optimized mesh, with the optimized triangle counts).
 * `stopPropagation` keeps clicks/drags off the OrbitControls underneath.
 */
export function ViewOptionsOverlay({ stats, onResetCamera }: { stats: OptimizedMeshStats | null; onResetCamera: () => void }) {
  const plane = useAppStore((s) => s.plane)
  const setPlaneAxisOrientation = useAppStore((s) => s.setPlaneAxisOrientation)
  const wireframe = useAppStore((s) => s.wireframe)
  const optimizedMesh = useAppStore((s) => s.optimizedMesh)
  const setWireframe = useAppStore((s) => s.setWireframe)
  const setOptimizedMesh = useAppStore((s) => s.setOptimizedMesh)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  const cycleAxis = () => setPlaneAxisOrientation(AXES[(AXES.indexOf(plane.axis) + 1) % 3], plane.orientation)
  const flip = () => setPlaneAxisOrientation(plane.axis, plane.orientation === 1 ? -1 : 1)

  return (
    <div
      className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-xl border border-neutral-800
        bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <button
        onClick={cycleAxis}
        title="Construction plane axis (click to cycle)"
        aria-label="Construction plane axis"
        onPointerEnter={() => setStatusMessage('Click to cycle the construction plane axis')}
        onPointerLeave={() => setStatusMessage(null)}
        className={`${BTN_BASE} font-mono text-sm font-semibold uppercase`}
      >
        {plane.axis}
      </button>
      <button
        onClick={flip}
        title={`Flip plane orientation (currently ${plane.orientation === 1 ? '+' : '−'})`}
        aria-label="Flip plane orientation"
        onPointerEnter={() => setStatusMessage('Click to flip the construction plane orientation')}
        onPointerLeave={() => setStatusMessage(null)}
        className={BTN_BASE}
      >
        <FlipHorizontal size={16} />
      </button>

      <div className="h-5 w-px bg-neutral-800" />

      <ToggleButton
        on={wireframe}
        onClick={() => setWireframe(!wireframe)}
        label="Wireframe"
        onPointerEnter={() => setStatusMessage('Toggle wireframe overlay on the 3D view')}
        onPointerLeave={() => setStatusMessage(null)}
      >
        <Grid3x3 size={16} />
      </ToggleButton>
      <ToggleButton
        on={optimizedMesh}
        onClick={() => setOptimizedMesh(!optimizedMesh)}
        label="Optimized mesh"
        onPointerEnter={() => setStatusMessage('Toggle optimized mesh rendering')}
        onPointerLeave={() => setStatusMessage(null)}
      >
        <Boxes size={16} />
      </ToggleButton>
      {optimizedMesh && stats && (
        <span className="px-1 font-mono text-[11px] tabular-nums text-neutral-400" title="triangles: optimized vs raw">
          {stats.optimizedTriangles.toLocaleString()}
          <span className="text-neutral-600"> / {stats.rawTriangles.toLocaleString()} tris</span>
        </span>
      )}

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
    </div>
  )
}
