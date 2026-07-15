import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Axis } from '@/engine/grid/types'
import { buildAnimatedSliceMeshes } from '@/engine/animation/animatedPreviewBuild'
import { isActiveAnimation, updateAnimatedGroupTransform } from '@/engine/animation/animationLayers'
import type { SliceKey } from '@/engine/animation/types'
import { useAppStore } from '@/store/useAppStore'

type AnimGroup = {
  group: THREE.Group
  axis: Axis
  center: THREE.Vector3
  sliceKey: SliceKey
}

export function AnimatedModelView() {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const animSettings = useAppStore((s) => s.animSettings)
  const sliceMasks = useAppStore((s) => s.sliceMasks)
  const texture = useAppStore((s) => s.texture)
  const glassRoughnessLevel = useAppStore((s) => s.glassRoughnessLevel)

  const animGroupRefs = useRef<Map<SliceKey, AnimGroup>>(new Map())
  const rootGroup = useMemo(() => new THREE.Group(), [])

  const built = useMemo(
    () => buildAnimatedSliceMeshes(model, palette, animSettings, sliceMasks, texture, glassRoughnessLevel),
    [model, palette, animSettings, sliceMasks, texture, glassRoughnessLevel],
  )

  // Build the scene graph imperatively — one Group per slice, with mesh children added directly.
  useEffect(() => {
    // Clean up previous groups
    const prevGroups = animGroupRefs.current
    for (const g of prevGroups.values()) {
      while (g.group.children.length > 0) {
        g.group.remove(g.group.children[0])
      }
    }
    prevGroups.clear()

    while (rootGroup.children.length > 0) {
      rootGroup.remove(rootGroup.children[0])
    }

    if (!built) return

    const { sliceMeshes, sliceInfo, materials } = built

    for (const [sliceKey, meshes] of sliceMeshes) {
      const group = new THREE.Group()
      const info = sliceKey !== '' ? sliceInfo.get(sliceKey) : undefined

      for (const { geometry, materialIndex } of meshes) {
        const mesh = new THREE.Mesh(geometry, materials[materialIndex])
        // Geometry vertices carry absolute voxel-grid coordinates. When the group itself is
        // positioned at the slice's pivot (`info.center`, also absolute), the mesh must be
        // recentered by `-center` here so the two don't stack into a double offset.
        if (info) mesh.position.copy(info.center).negate()
        group.add(mesh)
      }

      if (info) {
        group.position.copy(info.center)
        animGroupRefs.current.set(sliceKey, {
          group,
          axis: info.axis,
          center: info.center,
          sliceKey,
        })
      }

      rootGroup.add(group)
    }
  }, [built, rootGroup])

  useEffect(() => {
    return () => {
      if (built) {
        for (const m of built.materials) m.dispose()
        for (const meshes of built.sliceMeshes.values()) {
          for (const { geometry } of meshes) geometry.dispose()
        }
      }
      const prevGroups = animGroupRefs.current
      for (const g of prevGroups.values()) {
        while (g.group.children.length > 0) {
          g.group.remove(g.group.children[0])
        }
      }
      prevGroups.clear()
      while (rootGroup.children.length > 0) {
        rootGroup.remove(rootGroup.children[0])
      }
    }
  }, [built, rootGroup])

  useFrame(() => {
    const groups = animGroupRefs.current
    if (groups.size === 0) return

    const elapsed = performance.now() / 1000

    for (const g of groups.values()) {
      const settings = animSettings.get(g.sliceKey)
      if (!settings || !isActiveAnimation(settings.animationType)) continue
      updateAnimatedGroupTransform(g.group, g.center, g.axis, settings, elapsed)
    }
  })

  return <primitive object={rootGroup} />
}
