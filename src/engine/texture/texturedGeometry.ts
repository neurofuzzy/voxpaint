import type * as THREE from 'three'
import type { CellKey, VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { SliceKey } from '@/engine/animation/types'
import type { ColorGroupGeometry, SliceGroupGeometry, VertexUV } from '@/engine/instancing/voxelMeshBuilder'
import { buildTexturedShellGeometry, buildTexturedShellGeometryByColor, buildTexturedShellGeometryBySliceColor } from '@/engine/instancing/voxelMeshBuilder'
import { atlasUVFor, boxFaceForCell, worldToTexel } from './boxMapping'

/**
 * The box-map UV generator: pick the box face for the cell (chamfer → authored axis; cube → normal),
 * project the vertex onto that face, and place it in the atlas. Shared by the preview and export
 * geometry builders so both sample the identical atlas region.
 */
const uvFor: VertexUV = (chamfer, normal, vertex) => {
  const face = boxFaceForCell(chamfer, [normal.x, normal.y, normal.z])
  const [tu, tv] = worldToTexel(face, vertex.x, vertex.y, vertex.z)
  return atlasUVFor(face, tu, tv)
}

/** Box-mapped shell geometry for the Texture-mode 3D preview (single atlas-textured mesh). */
export function buildTexturedGeometry(model: VoxelModel, palette: PaletteState): THREE.BufferGeometry {
  return buildTexturedShellGeometry(model, palette, uvFor)
}

/** Box-mapped shell geometry split per (color, emissive class) for GLTF export. */
export function buildTexturedGeometryByColor(model: VoxelModel, palette: PaletteState): ColorGroupGeometry[] {
  return buildTexturedShellGeometryByColor(model, palette, uvFor)
}

/** Box-mapped shell geometry split per (color, emissive class, animation slice) for animated GLTF export. */
export function buildTexturedGeometryBySlice(
  model: VoxelModel,
  palette: PaletteState,
  nodeAssignment: Map<CellKey, SliceKey>,
): SliceGroupGeometry[] {
  return buildTexturedShellGeometryBySliceColor(model, palette, uvFor, nodeAssignment)
}
