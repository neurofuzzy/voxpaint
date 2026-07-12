import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildOptimizedVoxelGeometry } from '@/engine/instancing/voxelMeshBuilder'
import { useAppStore } from '@/store/useAppStore'

export type OptimizedMeshStats = { rawTriangles: number; optimizedTriangles: number }

/**
 * Renders the whole model as one merged, shell-culled, coplanar-optimized mesh (see
 * engine/instancing/voxelMeshBuilder.ts) — the 3D preview's "optimized mesh" mode. Per-vertex colors
 * come from each cell's palette slot. Rebuilds only when the model or palette changes. `onStats`
 * surfaces the before/after triangle counts to the overlay.
 */
export function OptimizedMeshView({ onStats }: { onStats?: (stats: OptimizedMeshStats) => void }) {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const wireframe = useAppStore((s) => s.wireframe)

  const built = useMemo(() => buildOptimizedVoxelGeometry(model, palette), [model, palette])

  useEffect(() => {
    onStats?.({ rawTriangles: built.rawTriangles, optimizedTriangles: built.optimizedTriangles })
  }, [built, onStats])

  // Free the previous geometry's GPU buffers when it's replaced or the view unmounts.
  useEffect(() => () => built.geometry.dispose(), [built])

  return (
    <mesh geometry={built.geometry}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} wireframe={wireframe} />
    </mesh>
  )
}
