import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { buildRigPoseMeshes } from '@/engine/animation/rigPoseBuild'
import { applyPoseMatrices, composePoseMatrices } from '@/engine/rigging/pose'
import { TEXEL_SCALE } from '@/engine/texture/types'
import { tickEmissiveAnimation } from '@/engine/instancing/previewMaterial'
import { enableGhostDither, setGhostDither } from '@/engine/instancing/ghostDither'
import { isolationPlanesForBox, setIsolationClip } from '@/engine/instancing/modelIsolate'
import { useActiveMemo } from './useActiveMemo'
import { useAppStore } from '@/store/useAppStore'

/**
 * Animate-mode pose preview: the model partitioned into one static group (unrigged voxels)
 * plus one group per rig box, each posed per frame from `poseRotations` via
 * `composePoseMatrices`. Geometry rebuilds only when the model/rigs change — gizmo drags just
 * re-matrix groups (matrixAutoUpdate off), so posing stays at frame rate with zero rebuilds.
 *
 * Active only while a non-empty pose exists; the static model views hide underneath. Materials
 * come from the same builder recipe as the animated preview, so ghost/isolate apply the same
 * way; emissive animation ticks along too.
 */
export function RigPoseView({ active }: { active: boolean }) {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const animateModelGhost = useAppStore((s) => s.mode === 'animate' && s.animateModelView === 'ghost')
  const texture = useAppStore((s) => s.texture)
  const glassRoughnessLevel = useAppStore((s) => s.glassRoughnessLevel)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const texelScale = useAppStore((s) => s.meta.texelScale ?? TEXEL_SCALE)
  const voxelScaleY = useAppStore((s) => s.meta.voxelScaleY)
  const mode = useAppStore((s) => s.mode)
  const rigBoxes = useAppStore((s) => s.rigBoxes)
  const selectedRigBoxId = useAppStore((s) => s.selectedRigBoxId)
  const isolateRig = useAppStore((s) => s.isolateRig)

  const rootGroup = useMemo(() => new THREE.Group(), [])
  const boxGroups = useRef(new Map<string, THREE.Group>())

  const built = useActiveMemo(active,
    () => buildRigPoseMeshes(model, palette, texture, gridExtent, glassRoughnessLevel, texelScale, rigBoxes),
    [model, palette, texture, gridExtent, glassRoughnessLevel, texelScale, rigBoxes],
  )

  // Build the scene graph imperatively — one static group plus one group per rig box, each
  // with matrixAutoUpdate off (the frame loop writes matrices straight from the pose store,
  // bypassing React renders during a gizmo drag).
  useEffect(() => {
    const groups = boxGroups.current
    groups.clear()
    while (rootGroup.children.length > 0) {
      rootGroup.remove(rootGroup.children[0])
    }
    // TEMP-DEBUG: view-build trace for the frozen-pose report.
    // eslint-disable-next-line no-console
    console.log('[pose] view build', built ? { staticMeshes: built.staticMeshes.length, boxes: [...built.boxMeshes.keys()] } : null)
    if (!built) return

    const statics = new THREE.Group()
    for (const { geometry, materialIndex } of built.staticMeshes) {
      statics.add(new THREE.Mesh(geometry, built.materials[materialIndex]))
    }
    rootGroup.add(statics)

    for (const [boxId, meshes] of built.boxMeshes) {
      const group = new THREE.Group()
      group.matrixAutoUpdate = false
      for (const { geometry, materialIndex } of meshes) {
        group.add(new THREE.Mesh(geometry, built.materials[materialIndex]))
      }
      groups.set(boxId, group)
      rootGroup.add(group)
    }
  }, [built, rootGroup])

  useEffect(() => {
    const groups = boxGroups.current
    const root = rootGroup
    return () => {
      if (built) {
        for (const m of built.materials) m.dispose()
        for (const meshes of built.boxMeshes.values()) {
          for (const { geometry } of meshes) geometry.dispose()
        }
        for (const { geometry } of built.staticMeshes) geometry.dispose()
      }
      groups.clear()
      while (root.children.length > 0) {
        root.remove(root.children[0])
      }
    }
  }, [built, rootGroup])

  useEffect(() => {
    if (!built) return
    for (const m of built.materials) {
      enableGhostDither(m)
      setGhostDither(m, animateModelGhost)
    }
  }, [built, animateModelGhost])

  const isolatedBox =
    isolateRig && mode === 'animate' ? rigBoxes.find((b) => b.id === selectedRigBoxId) ?? null : null
  const isolatePlanes = useMemo(
    () => (isolatedBox ? isolationPlanesForBox(isolatedBox, voxelScaleY) : null),
    [isolatedBox, voxelScaleY],
  )
  useEffect(() => {
    if (!built) return
    setIsolationClip(built.materials, isolatePlanes)
  }, [built, isolatePlanes])

  // TEMP-DEBUG: frame counter for the throttled matrix trace below.
  const frameRef = useRef(0)
  useFrame(() => {
    if (!active || !built) return
    const st = useAppStore.getState()
    if (st.poseRotations.size === 0) return
    const matrices = composePoseMatrices(st.rigBoxes, st.poseRotations)
    applyPoseMatrices(boxGroups.current, matrices)
    // TEMP-DEBUG: throttled matrix trace for the frozen-pose report.
    frameRef.current += 1
    if (frameRef.current % 60 === 0) {
      const first = [...matrices.entries()][0]
      // eslint-disable-next-line no-console
      console.log('[pose] frame matrices', first ? { box: first[0], m: [...first[1].elements].map((n) => +n.toFixed(3)) } : null)
    }
    for (const m of built.materials) tickEmissiveAnimation(m, performance.now() / 1000)
  })

  return <primitive object={rootGroup} visible={active} />
}
