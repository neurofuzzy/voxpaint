import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { buildOptimizedVoxelGroupsBySlice } from '@/engine/instancing/voxelMeshBuilder'
import { materialParamsFor } from '@/engine/palette/palette'
import { assignVoxelsToNodes, isActiveAnimation, isRotateMode, isSlideMode, sliceBBoxCenter, sliceWorldBasis } from '@/engine/animation/animationLayers'
import type { SliceKey } from '@/engine/animation/types'
import { useAppStore } from '@/store/useAppStore'

const BASE_CYCLE_SECONDS = 2

type AnimGroup = {
  group: THREE.Group
  axis: string
  center: THREE.Vector3
  sliceKey: SliceKey
}

export function AnimatedModelView() {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const animSettings = useAppStore((s) => s.animSettings)
  const glassRoughnessLevel = useAppStore((s) => s.glassRoughnessLevel)

  const animGroupRefs = useRef<Map<SliceKey, AnimGroup>>(new Map())
  const rootGroup = useMemo(() => new THREE.Group(), [])

  const built = useMemo(() => {
    if (animSettings.size === 0) return null
    const { nodes } = assignVoxelsToNodes(model, animSettings)

    const nodeAssignment = new Map<string, string>()
    for (const [sliceKey, entry] of nodes) {
      for (const key of entry.cellKeys) {
        nodeAssignment.set(key, sliceKey)
      }
    }

    const result = buildOptimizedVoxelGroupsBySlice(model, palette, nodeAssignment)

    const materials: THREE.MeshPhysicalMaterial[] = []
    const materialIndexMap = new Map<string, number>()

    const sliceMeshes = new Map<SliceKey, Array<{ geometry: THREE.BufferGeometry; materialIndex: number }>>()
    const sliceInfo = new Map<SliceKey, { axis: string; offset: number; center: THREE.Vector3 }>()

    for (const g of result.groups) {
      const matKey = `${g.materialClass}:${g.colorKey}`
      let matIdx = materialIndexMap.get(matKey)
      if (matIdx === undefined) {
        matIdx = materials.length
        materialIndexMap.set(matKey, matIdx)
        const params = materialParamsFor(g.materialClass)
        const color = new THREE.Color(g.colorKey)
        const isGlass = g.materialClass === 'glass'
        const m = new THREE.MeshPhysicalMaterial({
          color,
          metalness: params.metalness,
          roughness: isGlass ? glassRoughnessLevel : params.roughness,
          transmission: params.transmission,
          side: THREE.DoubleSide,
        })
        if (params.transmission > 0) {
          m.ior = 1.5
          m.thickness = 0.5
        }
        if (params.emissiveIntensity > 0) {
          m.emissive = color
          m.emissiveIntensity = params.emissiveIntensity
        }
        materials.push(m)
      }

      let meshes = sliceMeshes.get(g.sliceKey)
      if (!meshes) {
        meshes = []
        sliceMeshes.set(g.sliceKey, meshes)
      }
      meshes.push({ geometry: g.geometry, materialIndex: matIdx })

      if (g.sliceKey && !sliceInfo.has(g.sliceKey)) {
        const entry = nodes.get(g.sliceKey)
        if (entry) {
          const center = sliceBBoxCenter(model, entry.axis, entry.offset)
          if (center) {
            sliceInfo.set(g.sliceKey, { axis: entry.axis, offset: entry.offset, center })
          }
        }
      }
    }

    return { nodes, sliceMeshes, sliceInfo, materials }
  }, [model, palette, animSettings, glassRoughnessLevel])

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

    for (const [_sliceKey, g] of groups) {
      const settings = animSettings.get(g.sliceKey)
      if (!settings || !isActiveAnimation(settings.animationType)) {
        continue
      }

      const duration = BASE_CYCLE_SECONDS / settings.speed
      const t = ((elapsed % duration) / duration)

      if (isRotateMode(settings.animationType)) {
        const { normal } = sliceWorldBasis(g.axis as any)
        const angle = settings.animationType === 'rotate-cw' ? t * Math.PI * 2 : -t * Math.PI * 2
        g.group.position.copy(g.center)
        g.group.quaternion.setFromAxisAngle(normal, angle)
      } else if (isSlideMode(settings.animationType)) {
        const { uDir, vDir } = sliceWorldBasis(g.axis as any)
        const dir = settings.animationType === 'slide-horizontal' ? uDir : vDir
        const amplitude = settings.slideAmount

        // Sine wave, matching the CUBICSPLINE curve baked into the GLTF export (animationGLTF.ts)
        // rather than a linear back-and-forth — so the preview matches the exported motion.
        const offset = Math.sin(t * Math.PI * 2)

        g.group.position.copy(g.center).addScaledVector(dir, offset * amplitude)
        g.group.quaternion.identity()
      }
    }
  })

  return <primitive object={rootGroup} />
}
