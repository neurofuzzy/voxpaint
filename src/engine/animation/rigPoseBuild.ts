import * as THREE from 'three'
import type { CellKey, GridExtent, VoxelModel } from '@/engine/grid/types'
import { decodeKey } from '@/engine/grid/GridStore'
import type { PaletteState } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
import { TEXEL_SCALE } from '@/engine/texture/types'
import { bakeOverlayTexturesByColor } from '@/engine/texture/overlay'
import { buildTexturedGeometryBySlice } from '@/engine/texture/texturedGeometry'
import { hasTextureContent } from '@/engine/texture/TextureStore'
import { buildOptimizedVoxelGroupsBySlice } from '@/engine/instancing/voxelMeshBuilder'
import { buildPreviewMaterial } from '@/engine/instancing/previewMaterial'
import { buildEmissiveAnimIndex } from '@/engine/palette/emissiveAnimation'
import { darkestBaseColor } from '@/engine/palette/palette'
import { rigIdForCoord, type RigBox } from '@/engine/rigging/types'

export type RigPoseMeshes = {
  /** Merged meshes for voxels outside every rig box — one static group, identity transform. */
  staticMeshes: Array<{ geometry: THREE.BufferGeometry; materialIndex: number }>
  /** Per-box meshes (absolute grid coords), posed each frame by the box's composed matrix. */
  boxMeshes: Map<string, Array<{ geometry: THREE.BufferGeometry; materialIndex: number }>>
  materials: THREE.MeshPhysicalMaterial[]
}

/**
 * Partitions the model for pose preview: unrigged voxels merge into one static group while
 * each rig box's voxels get their own group(s), so `RigPoseView` can re-matrix posed subtrees
 * per frame with zero geometry rebuilds during a gizmo drag. Returns null when no voxel is
 * rigged (the caller then keeps the normal static views). Mirrors `buildAnimatedSliceMeshes`
 * — same geometry builders, same materials — so the posed preview matches the static look
 * (paint overlays included) exactly.
 */
export function buildRigPoseMeshes(
  model: VoxelModel,
  palette: PaletteState,
  texture: TextureModel,
  gridExtent: GridExtent,
  glassRoughnessLevel: number,
  texelScale: number = TEXEL_SCALE,
  rigBoxes?: RigBox[],
): RigPoseMeshes | null {
  if (!rigBoxes || rigBoxes.length === 0) return null
  const rigAssignment = new Map<CellKey, string>()
  for (const key of model.color.keys()) {
    const id = rigIdForCoord(rigBoxes, decodeKey(key))
    if (id) rigAssignment.set(key, id)
  }
  if (rigAssignment.size === 0) return null

  const textured = hasTextureContent(texture)
  const groups = textured
    ? buildTexturedGeometryBySlice(model, palette, new Map(), gridExtent, texelScale, true, rigAssignment)
    : buildOptimizedVoxelGroupsBySlice(model, palette, new Map(), true, true, rigAssignment).groups

  const overlayByColor = textured
    ? bakeOverlayTexturesByColor(groups.map((g) => g.colorKey), buildBlendAtlas(texture, gridExtent, texelScale))
    : null

  const emissiveAnimIndex = buildEmissiveAnimIndex(palette)
  const emissiveAnimOffColor = new THREE.Color(darkestBaseColor(palette))
  const materials: THREE.MeshPhysicalMaterial[] = []
  const materialIndexMap = new Map<string, number>()

  const staticMeshes: RigPoseMeshes['staticMeshes'] = []
  const boxMeshes: RigPoseMeshes['boxMeshes'] = new Map()
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
    const entry = { geometry: g.geometry, materialIndex: matIdx }
    if (g.rigId) {
      let list = boxMeshes.get(g.rigId)
      if (!list) {
        list = []
        boxMeshes.set(g.rigId, list)
      }
      list.push(entry)
    } else {
      staticMeshes.push(entry)
    }
  }

  return { staticMeshes, boxMeshes, materials }
}
