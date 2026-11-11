import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { useAppStore } from '@/store/useAppStore'

/**
 * Renders every subdivided parent's split mid-planes as thin line squares, so detail reads in
 * the 3D view without the full wireframe soup: one mid-plane square per split axis (a
 * depth-split shows one square, quarters show two, a full split three). Gated on the
 * `wireframe` toggle, mounted beside the other construction-plane chrome (inside the voxel
 * Y-scale group, so coordinates stay grid-native). Raycast-disabled — picking keeps running
 * against the invisible AABB pick mesh.
 */
export function DetailEdgesOverlay() {
  const model = useAppStore((s) => s.model)
  const wireframe = useAppStore((s) => s.wireframe)

  const geometry = useMemo(() => {
    const positions: number[] = []
    const push = (a: number[], b: number[]) => {
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
    for (const [key, sub] of model.subdiv) {
      const parent = decodeKey(key)
      for (const a of sub.split) {
        const ai = axisIndex(a)
        const at = parent[ai] + 0.5
        const others = [0, 1, 2].filter((j) => j !== ai)
        const corner = (bj: number, bk: number): number[] => {
          const p = [parent[0], parent[1], parent[2]]
          p[others[0]] = parent[others[0]] + bj
          p[others[1]] = parent[others[1]] + bk
          p[ai] = at
          return p
        }
        const c00 = corner(0, 0)
        const c10 = corner(1, 0)
        const c11 = corner(1, 1)
        const c01 = corner(0, 1)
        push(c00, c10)
        push(c10, c11)
        push(c11, c01)
        push(c01, c00)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return g
  }, [model])
  useEffect(() => () => geometry.dispose(), [geometry])

  if (!wireframe) return null
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color="#e8e8f0" transparent opacity={0.55} depthWrite={false} />
    </lineSegments>
  )
}
