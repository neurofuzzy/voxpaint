import { Boxes, Grid3x3 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { OptimizedMeshStats } from './OptimizedMeshView'

const BTN_BASE = 'flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
const BTN_ON = 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/25 hover:text-violet-200'

function ToggleButton({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={on} title={label} className={`${BTN_BASE} ${on ? BTN_ON : ''}`}>
      {children}
    </button>
  )
}

/**
 * Frosted overlay pinned to the top-right of the 3D preview with the two view toggles: Wireframe and
 * Optimized mesh. When the optimized mesh is on, shows its before/after triangle counts.
 * `stopPropagation` keeps clicks/drags off the OrbitControls underneath.
 */
export function ViewOptionsOverlay({ stats }: { stats: OptimizedMeshStats | null }) {
  const wireframe = useAppStore((s) => s.wireframe)
  const optimizedMesh = useAppStore((s) => s.optimizedMesh)
  const setWireframe = useAppStore((s) => s.setWireframe)
  const setOptimizedMesh = useAppStore((s) => s.setOptimizedMesh)

  return (
    <div
      className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-xl border border-neutral-800
        bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <ToggleButton on={wireframe} onClick={() => setWireframe(!wireframe)} label="Wireframe">
        <Grid3x3 size={16} />
      </ToggleButton>
      <ToggleButton on={optimizedMesh} onClick={() => setOptimizedMesh(!optimizedMesh)} label="Optimized mesh">
        <Boxes size={16} />
      </ToggleButton>
      {optimizedMesh && stats && (
        <span className="px-1 font-mono text-[11px] tabular-nums text-neutral-400" title="triangles: optimized vs raw">
          {stats.optimizedTriangles.toLocaleString()}
          <span className="text-neutral-600"> / {stats.rawTriangles.toLocaleString()} tris</span>
        </span>
      )}
    </div>
  )
}
