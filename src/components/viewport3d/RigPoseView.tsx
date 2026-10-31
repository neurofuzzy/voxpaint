import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { buildRigPoseMeshes } from '@/engine/animation/rigPoseBuild'
import { applyPoseMatrices } from '@/engine/rigging/pose'
import { previewFrame } from '@/engine/rigging/preview'
import { hasActiveTweens } from '@/engine/rigging/rigLoop'
import { TEXEL_SCALE } from '@/engine/texture/types'
import { tickEmissiveAnimation } from '@/engine/instancing/previewMaterial'
import { enableGhostDither, setGhostDither } from '@/engine/instancing/ghostDither'
import { isolationPlanesForBox, setIsolationClip } from '@/engine/instancing/modelIsolate'
import { useActiveMemo } from './useActiveMemo'
import { useAppStore } from '@/store/useAppStore'

/**
 * Animate-mode pose + loop preview: the model partitioned into one static group (unrigged
 * voxels) plus one group per rig box, each driven per frame from the store through
 * `previewFrame` (tween stacks in tweens mode, the clip/scratch pose in poses mode).
 * Geometry rebuilds only when the model/rigs
 * change — drags and cycles just re-matrix groups (matrixAutoUpdate off), so playback stays
 * at frame rate with zero rebuilds.
 *
 * Active while a non-empty pose exists or any box has active tweens; the static model
 * views hide underneath. Materials come from the same builder recipe as the animated preview, so
 * ghost/isolate apply the same way; emissive animation ticks along too.
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

  useFrame(() => {
    if (!active || !built) return
    const st = useAppStore.getState()
    const elapsed = performance.now() / 1000
    const { worlds: combined, pose } = previewFrame(st, elapsed)
    if (pose.size === 0 && !hasActiveTweens(st.rigBoxes)) return
    applyPoseMatrices(boxGroups.current, combined)
    for (const m of built.materials) tickEmissiveAnimation(m, performance.now() / 1000)
  })

  return <primitive object={rootGroup} visible={active} />
}
