import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { rigPivotLinks } from '@/engine/rigging/types'
import { posedPivotWorld } from '@/engine/rigging/pose'
import { useAppStore } from '@/store/useAppStore'

const LINK_AMBER = '#f59e0b' // amber-500, matching unselected rig box outlines
const LINK_ACTIVE = '#ffffff' // white, matching the selected rig box's outline

/**
 * Dotted parent→child pivot links (Animate mode only): one dashed segment per outline edge,
 * from the parent box's rotation center to the child's. Colored by the child — white while
 * that child is selected, amber otherwise — matching the box outlines and pivot spheres.
 * Endpoints ride the pose (posed pivot world points), so links stay glued to the joints.
 * Drawn on top of geometry like the pivots themselves. Null when there are no links.
 * Lives under Viewport3D's Y-scale group (grid coordinates).
 */
export function RigLinkLines() {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const isAnimate = useAppStore((s) => s.mode === 'animate')
  // Links connect pairs of pivots — with only one box visible there is nothing to join.
  const isolating = useAppStore((s) => s.isolateRig)
  const poseRotations = useAppStore((s) => s.poseRotations)

  const amberRef = useRef<THREE.LineSegments>(null)
  const whiteRef = useRef<THREE.LineSegments>(null)

  const { amberGeo, whiteGeo } = useMemo(() => {
    const byId = new Map(rigBoxes.map((b) => [b.id, b]))
    const amber: number[] = []
    const white: number[] = []
    for (const link of rigPivotLinks(rigBoxes)) {
      const parent = byId.get(link.parentId)
      const child = byId.get(link.childId)
      if (!parent || !child) continue
      // Posed world points (already +0.5 per axis), mirroring PivotGizmo.
      const pts = [posedPivotWorld(rigBoxes, poseRotations, parent), posedPivotWorld(rigBoxes, poseRotations, child)].flatMap((p) => [p[0], p[1], p[2]])
      ;(link.childId === selectedRigBoxId ? white : amber).push(...pts)
    }
    const toGeo = (arr: number[]) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3))
      return g
    }
    return { amberGeo: toGeo(amber), whiteGeo: toGeo(white) }
  }, [rigBoxes, selectedRigBoxId, poseRotations])

  useEffect(() => () => {
    amberGeo.dispose()
    whiteGeo.dispose()
  }, [amberGeo, whiteGeo])

  // Dashed materials need per-vertex line distances — recompute whenever the segments change.
  useEffect(() => {
    amberRef.current?.computeLineDistances()
    whiteRef.current?.computeLineDistances()
  }, [amberGeo, whiteGeo])

  if (!isAnimate || isolating) return null
  // LineSegments with an empty position attribute renders nothing, so no count guard needed.

  return (
    <group>
      <lineSegments geometry={amberGeo} ref={amberRef} raycast={() => null} renderOrder={9}>
        <lineDashedMaterial color={LINK_AMBER} toneMapped={false} dashSize={0.15} gapSize={0.1} depthTest={false} transparent opacity={0.9} />
      </lineSegments>
      <lineSegments geometry={whiteGeo} ref={whiteRef} raycast={() => null} renderOrder={9}>
        <lineDashedMaterial color={LINK_ACTIVE} toneMapped={false} dashSize={0.15} gapSize={0.1} depthTest={false} transparent opacity={0.95} />
      </lineSegments>
    </group>
  )
}
