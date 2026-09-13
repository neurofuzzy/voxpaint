import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { effectiveExtent } from '@/engine/grid/GridStore'
import { useAppStore } from '@/store/useAppStore'

/**
 * Subtle wireframe box around the project's working volume in the 3D view (model/animate mode —
 * texture mode already draws its own brighter face-picking box). Wraps the even effective grid
 * (odd sizes round up), centered on the origin, matching the texture-mode box so the bounds read
 * identically across modes. Purely decorative: raycasting is disabled so it can never intercept
 * voxel picking or hover.
 */
export function ProjectBoundsBox() {
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  // Rebuild only when the locked-in size changes (never mid-edit).
  const size = effectiveExtent(gridExtent)
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), [size])
  useEffect(() => () => edges.dispose(), [edges])

  return (
    <lineSegments geometry={edges} raycast={() => null}>
      <lineBasicMaterial color="#6b7a8a" toneMapped={false} transparent opacity={0.25} />
    </lineSegments>
  )
}
