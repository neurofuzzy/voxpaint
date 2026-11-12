import { useMemo } from 'react'
import * as THREE from 'three'
import { encodeKey, viewOriginShift } from '@/engine/grid/GridStore'
import type { Coord, SplitAxis } from '@/engine/grid/types'
import { axisIndex, outwardNormal } from '@/engine/plane/planeGeometry'
import { useAppStore } from '@/store/useAppStore'
import { AXIS_UNIT_VECTOR, UP, toVector3 } from './axisVectors'

const PLANE_CENTER_ADJUST = 0.5

/** Depth of the plane along its axis: the voxel centre on a whole stop, the slab's own centre
 * (a quarter in from the low or high face) on a half-voxel stop. */
function planeDepth(offset: number, half: 0 | 1 | null): number {
  return half === null ? offset + PLANE_CENTER_ADJUST : offset + 0.25 + 0.5 * half
}
const AXES: SplitAxis[] = ['x', 'y', 'z']

/**
 * Subdivision refinement lines on the active plane — the 3D twin of the 2D canvas's per-cell
 * pass: every cell in the slice gets a mid-cell line along each split axis lying in the plane,
 * from its own `subdiv` split plus the armed `gridSplit` (so the edit grid reads before an edit).
 * Built in WORLD space (a cell `c` spans `[c, c+1]` on each axis; the plane's own depth is
 * `offset + 0.5`), colored like the plane's fine grid so a subdivided grid is the same grid, finer.
 */
function SubdivisionLines({ n, shift, color }: { n: number; shift: number; color: string }) {
  const plane = useAppStore((s) => s.plane)
  const subdiv = useAppStore((s) => s.model.subdiv)
  const gridSplit = useAppStore((s) => s.gridSplit)
  const model = useAppStore((s) => s.mode === 'model')

  const geometry = useMemo(() => {
    const pts: number[] = []
    const ai = AXES.indexOf(plane.axis)
    const [ia, ib] = [0, 1, 2].filter((i) => i !== ai)
    const lo = shift - n / 2
    const depth = planeDepth(plane.offset, plane.half)
    for (let a = lo; a < lo + n; a++) {
      for (let b = lo; b < lo + n; b++) {
        const c: Coord = [0, 0, 0]
        c[ai] = plane.offset
        c[ia] = a
        c[ib] = b
        const own = subdiv.get(encodeKey(...c))?.split
        const armed = model ? gridSplit : null
        if (!own && !armed) continue
        const split = [...new Set([...(own ?? []), ...(armed ?? [])])]
        for (const ax of split) {
          const k = AXES.indexOf(ax)
          if (k === ai) continue
          // A split along axis k puts a line perpendicular to k, spanning the cell along the other.
          const other = k === ia ? ib : ia
          const p0 = [0, 0, 0]
          const p1 = [0, 0, 0]
          p0[ai] = p1[ai] = depth
          p0[k] = p1[k] = c[k] + 0.5
          p0[other] = c[other]
          p1[other] = c[other] + 1
          pts.push(...p0, ...p1)
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [plane.axis, plane.offset, plane.half, subdiv, gridSplit, model, n, shift])

  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={color} toneMapped={false} />
    </lineSegments>
  )
}

/**
 * Visualizes the active construction plane as a plane-aligned grid and a static arrow indicator
 * showing its axis and orientation.
 */
export function ConstructionPlaneVisual() {
  const plane = useAppStore((s) => s.plane)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)

  const axisVec = AXIS_UNIT_VECTOR[plane.axis]
  // Half-cell in-plane nudge for odd sizes so the grid centres on the center pillar (matching the
  // gizmo at [shift,shift,shift] and the 2D view). Zero along the plane's own axis — depth is
  // already at cell-centre via PLANE_CENTER_ADJUST.
  const shift = viewOriginShift(gridExtent)
  const position = useMemo(() => {
    const p = axisVec.clone().multiplyScalar(planeDepth(plane.offset, plane.half))
    const inPlaneShift = new THREE.Vector3(shift, shift, shift)
    inPlaneShift.setComponent(axisIndex(plane.axis), 0)
    return p.add(inPlaneShift)
  }, [axisVec, plane.offset, plane.half, plane.axis, shift])
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, axisVec), [axisVec])
  const arrowDir = useMemo(
    () => toVector3(outwardNormal(plane.axis, plane.orientation)),
    [plane.axis, plane.orientation],
  )
  const arrowQuaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, arrowDir), [arrowDir])

  // Draw the project's own extent (odd or even). The `position` above shifts the group half a cell
  // in-plane for odd sizes, so a size-`n` gridHelper (whose lines sit at half-integers about its
  // centre) lands its lines back on integer cell boundaries and frames cells centred on the pillar.
  // On a half-voxel stop the plane sits at the slab's own depth (see `planeDepth`).
  const n = gridExtent
  // ONE line color for the whole plane — cell lines and subdivision lines alike.
  const gridColor = '#3d6d8a'

  return (
    <group>
      <group position={position} quaternion={quaternion}>
        <mesh rotation-x={-Math.PI / 2} raycast={() => null}>
          <planeGeometry args={[n, n]} />
          <meshBasicMaterial color="#4ad9ff" transparent opacity={0.035} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <gridHelper args={[n, n, gridColor, gridColor]} />
      </group>

      <SubdivisionLines n={n} shift={shift} color={gridColor} />

      <group position={position} quaternion={arrowQuaternion}>
        <mesh position={[0, 2.6, 0]} raycast={() => null}>
          <coneGeometry args={[0.28, 0.7, 14]} />
          <meshStandardMaterial color="#f2c94c" emissive="#f2c94c" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 1.4, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.07, 0.07, 2, 10]} />
          <meshStandardMaterial color="#f2c94c" emissive="#f2c94c" emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  )
}
