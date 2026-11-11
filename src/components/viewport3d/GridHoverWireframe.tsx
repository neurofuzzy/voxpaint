import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import { voxelWireframeSegments } from '@/engine/grid/subdiv'
import { useAppStore } from '@/store/useAppStore'

/**
 * Hover wireframe for the paint tool's edit grid: the hovered voxel's 12 box edges plus
 * the mid-plane squares describing its division — the current split for an already
 * subdivided voxel, the toolbar's armed grid division (the coming just-in-time cut)
 * for a plain one. Always on while paint is selected, independent of the `wireframe`
 * toggle, so the cut target reads in 3D exactly like the 2D gold hover fill. On
 * half-step only subdivided voxels preview (plain taps refuse) — matching the ghost
 * suppression. Grid-native coordinates (mounted inside the Y-scale group); raycast-disabled so
 * picking is unaffected.
 */
export function GridHoverWireframe() {
  const activeTool = useAppStore((s) => s.activeTool)
  const hoveredFace = useAppStore((s) => s.hoveredFace)
  const model = useAppStore((s) => s.model)
  const pendingSplit = useAppStore((s) => s.pendingSplit)
  const half = useAppStore((s) => s.plane.half)

  const geometry = useMemo(() => {
    if (activeTool !== 'paint' || !hoveredFace) return null
    const cell = decodeKey(hoveredFace.cellKey)
    const sub = model.subdiv.get(hoveredFace.cellKey)
    if (half !== null && !sub) return null
    const segments = voxelWireframeSegments(cell, sub ? [...sub.split] : pendingSplit ? [...pendingSplit] : null)
    const positions = new Float32Array(segments.length * 6)
    segments.forEach(([a, b], i) => {
      positions.set([a[0], a[1], a[2], b[0], b[1], b[2]], i * 6)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [activeTool, hoveredFace, model, pendingSplit, half])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color="#f2c94c" transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  )
}
