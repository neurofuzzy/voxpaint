import * as THREE from 'three'
import type { Axis, CellKey, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
import { bakeOverlayTexturesByColor } from '@/engine/texture/overlay'
import { buildTexturedGeometryBySlice } from '@/engine/texture/texturedGeometry'
import { hasTextureContent } from '@/engine/texture/TextureStore'
import { buildOptimizedVoxelGroupsBySlice } from '@/engine/instancing/voxelMeshBuilder'
import { buildPreviewMaterial } from '@/engine/instancing/previewMaterial'
import { buildEmissiveAnimIndex } from '@/engine/palette/emissiveAnimation'
import { darkestBaseColor } from '@/engine/palette/palette'
import { assignVoxelsToNodes, resolveAnimCenter } from './animationLayers'
import type { SliceAnimSettings, SliceKey } from './types'

export type AnimatedSliceMeshes = {
  nodes: Map<SliceKey, { cellKeys: CellKey[]; axis: Axis; offset: number }>
  sliceMeshes: Map<SliceKey, Array<{ geometry: THREE.BufferGeometry; materialIndex: number }>>
  sliceInfo: Map<SliceKey, { axis: Axis; offset: number; center: THREE.Vector3 }>
  materials: THREE.MeshPhysicalMaterial[]
}

/**
 * Partitions the model into per-slice animation nodes and builds the geometry/material groups for
 * the live 3D preview (`AnimatedModelView`). Uses the same box-mapped + baked-overlay geometry the
 * glTF export uses whenever the model has painted texture content, so Animate mode's preview shows
 * paint (not just solid palette color) exactly like Model/Texture mode. Returns null when no slice
 * has an active animation, so the caller can fall back to the static (non-animated) mesh view.
 */
export function buildAnimatedSliceMeshes(
  model: VoxelModel,
  palette: PaletteState,
  animSettings: Map<SliceKey, SliceAnimSettings>,
  sliceMasks: Map<SliceKey, Set<CellKey>>,
  texture: TextureModel,
  gridExtent: GridExtent,
  glassRoughnessLevel: number,
  slicePivots: Map<SliceKey, CellKey>,
): AnimatedSliceMeshes | null {
  if (animSettings.size === 0) return null
  const { nodes } = assignVoxelsToNodes(model, animSettings, sliceMasks)

  const nodeAssignment = new Map<CellKey, SliceKey>()
  for (const [sliceKey, entry] of nodes) {
    for (const key of entry.cellKeys) {
      nodeAssignment.set(key, sliceKey)
    }
  }

  const textured = hasTextureContent(texture)
  const groups = textured
    ? buildTexturedGeometryBySlice(model, palette, nodeAssignment, gridExtent)
    : buildOptimizedVoxelGroupsBySlice(model, palette, nodeAssignment).groups

  const overlayByColor = textured
    ? bakeOverlayTexturesByColor(groups.map((g) => g.colorKey), buildBlendAtlas(texture, gridExtent))
    : null

  const emissiveAnimIndex = buildEmissiveAnimIndex(palette)
  const emissiveAnimOffColor = new THREE.Color(darkestBaseColor(palette))
  const materials: THREE.MeshPhysicalMaterial[] = []
  const materialIndexMap = new Map<string, number>()

  const sliceMeshes = new Map<SliceKey, Array<{ geometry: THREE.BufferGeometry; materialIndex: number }>>()
  const sliceInfo = new Map<SliceKey, { axis: Axis; offset: number; center: THREE.Vector3 }>()

  for (const g of groups) {
    const matKey = `${g.materialClass}:${g.colorKey}`
    let matIdx = materialIndexMap.get(matKey)
    if (matIdx === undefined) {
      matIdx = materials.length
      materialIndexMap.set(matKey, matIdx)
      materials.push(buildPreviewMaterial(g.materialClass, g.colorKey, {
        overlayMap: overlayByColor?.get(g.colorKey) ?? null,
        glassRoughnessLevel,
        emissiveAnimMode: emissiveAnimIndex.get(g.colorKey),
        emissiveAnimOffColor,
      }))
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
        const settings = animSettings.get(g.sliceKey)!
        const center = resolveAnimCenter(entry.cellKeys, entry.axis, entry.offset, settings.animationType, slicePivots)
        if (center) {
          sliceInfo.set(g.sliceKey, { axis: entry.axis, offset: entry.offset, center })
        }
      }
    }
  }

  return { nodes, sliceMeshes, sliceInfo, materials }
}
