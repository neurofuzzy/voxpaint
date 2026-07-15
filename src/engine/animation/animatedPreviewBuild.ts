import * as THREE from 'three'
import type { Axis, CellKey, VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import { materialParamsFor } from '@/engine/palette/palette'
import { buildOptimizedVoxelGroupsBySlice } from '@/engine/instancing/voxelMeshBuilder'
import { assignVoxelsToNodes, bboxCenterOfKeys } from './animationLayers'
import type { SliceAnimSettings, SliceKey } from './types'

export type AnimatedSliceMeshes = {
  nodes: Map<SliceKey, { cellKeys: CellKey[]; axis: Axis; offset: number }>
  sliceMeshes: Map<SliceKey, Array<{ geometry: THREE.BufferGeometry; materialIndex: number }>>
  sliceInfo: Map<SliceKey, { axis: Axis; offset: number; center: THREE.Vector3 }>
  materials: THREE.MeshPhysicalMaterial[]
}

/**
 * Partitions the model into per-slice animation nodes and builds the optimized geometry/material
 * groups for the live 3D preview (`AnimatedModelView`). Returns null when no slice has an active
 * animation, so the caller can fall back to the static (non-animated) mesh view.
 */
export function buildAnimatedSliceMeshes(
  model: VoxelModel,
  palette: PaletteState,
  animSettings: Map<SliceKey, SliceAnimSettings>,
  sliceMasks: Map<SliceKey, Set<CellKey>>,
  glassRoughnessLevel: number,
): AnimatedSliceMeshes | null {
  if (animSettings.size === 0) return null
  const { nodes } = assignVoxelsToNodes(model, animSettings, sliceMasks)

  const nodeAssignment = new Map<CellKey, SliceKey>()
  for (const [sliceKey, entry] of nodes) {
    for (const key of entry.cellKeys) {
      nodeAssignment.set(key, sliceKey)
    }
  }

  const result = buildOptimizedVoxelGroupsBySlice(model, palette, nodeAssignment)

  const materials: THREE.MeshPhysicalMaterial[] = []
  const materialIndexMap = new Map<string, number>()

  const sliceMeshes = new Map<SliceKey, Array<{ geometry: THREE.BufferGeometry; materialIndex: number }>>()
  const sliceInfo = new Map<SliceKey, { axis: Axis; offset: number; center: THREE.Vector3 }>()

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
        const center = bboxCenterOfKeys(entry.cellKeys)
        if (center) {
          sliceInfo.set(g.sliceKey, { axis: entry.axis, offset: entry.offset, center })
        }
      }
    }
  }

  return { nodes, sliceMeshes, sliceInfo, materials }
}
