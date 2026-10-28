import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { rigPivotLinks } from '@/engine/rigging/types'
import { resolvePreviewPose } from '@/engine/rigging/pose'
import { composeAnimatedMatrices, pivotWorldFromMatrix } from '@/engine/rigging/rigLoop'
import { useAppStore } from '@/store/useAppStore'

const LINK_AMBER = '#f59e0b' // amber-500, matching unselected rig box outlines
const LINK_ACTIVE = '#ffffff' // white, matching the selected rig box's outline

/**
 * Dotted parent→child pivot links (Animate mode only): one dashed segment per outline edge,
 * from the parent box's rotation center to the child's. Colored by the child — white while
 * that child is selected, amber otherwise — matching the box outlines and pivot spheres.
 * Endpoints ride full animation (tween stacks × pose), written per frame into preallocated
 * buffers from the same composed world matrices the voxel meshes use, so links stay glued
 * to the moving joints with zero React re-renders and zero per-frame geometry allocation.
 * Drawn on top of geometry like the pivots themselves. Null when there are no links.
 * Lives under Viewport3D's Y-scale group (grid coordinates).
 */
export function RigLinkLines() {
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const isAnimate = useAppStore((s) => s.mode === 'animate')
  // Links connect pairs of pivots — with only one box visible there is nothing to join.
  const isolating = useAppStore((s) => s.isolateRig)

  const amberRef = useRef<THREE.LineSegments>(null)
  const whiteRef = useRef<THREE.LineSegments>(null)

  // Topology only (id pairs) — endpoints are recomputed every frame below.
  const links = useMemo(() => rigPivotLinks(rigBoxes), [rigBoxes])

  const { amberGeo, whiteGeo } = useMemo(() => {
    const toGeo = (segments: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(segments, 1) * 6), 3).setUsage(THREE.DynamicDrawUsage))
      return g
    }
    return { amberGeo: toGeo(links.length), whiteGeo: toGeo(links.length) }
  }, [links])

  useEffect(() => () => {
    amberGeo.dispose()
    whiteGeo.dispose()
  }, [amberGeo, whiteGeo])

  useFrame(() => {
    const st = useAppStore.getState()
    if (st.mode !== 'animate') return
    const amber = amberGeo.getAttribute('position') as THREE.BufferAttribute
    const white = whiteGeo.getAttribute('position') as THREE.BufferAttribute
    const now = performance.now() / 1000
    const cycleTime = st.cyclePlaying && st.poseCycle ? now - st.cycleStartedAt : null
    const preview = resolvePreviewPose(st.poses, st.stagedPoseId, st.poseRotations, st.poseCycle, cycleTime)
    const matrices = composeAnimatedMatrices(st.rigBoxes, preview, now)
    const byId = new Map(st.rigBoxes.map((b) => [b.id, b]))
    let amberCount = 0
    let whiteCount = 0
    for (const link of links) {
      const parent = byId.get(link.parentId)
      const child = byId.get(link.childId)
      const pm = parent ? matrices.get(parent.id) : undefined
      const cm = child ? matrices.get(child.id) : undefined
      if (!parent || !child || !pm || !cm) continue
      const from = pivotWorldFromMatrix(pm, parent)
      const to = pivotWorldFromMatrix(cm, child)
      const attr = link.childId === st.selectedRigBoxId ? white : amber
      const i = (link.childId === st.selectedRigBoxId ? whiteCount++ : amberCount++) * 6
      attr.setXYZ(i / 3, from[0], from[1], from[2])
      attr.setXYZ(i / 3 + 1, to[0], to[1], to[2])
    }
    amber.needsUpdate = true
    white.needsUpdate = true
    amberGeo.setDrawRange(0, amberCount * 2)
    whiteGeo.setDrawRange(0, whiteCount * 2)
    amberRef.current?.computeLineDistances()
    whiteRef.current?.computeLineDistances()
  })

  if (!isAnimate || isolating) return null
  // LineSegments with an empty position attribute renders nothing, so no count guard needed.

  return (
    <group>
      {/* Positions stream every frame — never let a stale bound cull the lines. */}
      <lineSegments geometry={amberGeo} ref={amberRef} raycast={() => null} renderOrder={9} frustumCulled={false}>
        <lineDashedMaterial color={LINK_AMBER} toneMapped={false} dashSize={0.15} gapSize={0.1} depthTest={false} transparent opacity={0.9} />
      </lineSegments>
      <lineSegments geometry={whiteGeo} ref={whiteRef} raycast={() => null} renderOrder={9} frustumCulled={false}>
        <lineDashedMaterial color={LINK_ACTIVE} toneMapped={false} dashSize={0.15} gapSize={0.1} depthTest={false} transparent opacity={0.95} />
      </lineSegments>
    </group>
  )
}
