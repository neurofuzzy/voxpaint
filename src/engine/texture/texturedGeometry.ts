import type * as THREE from 'three'
import type { CellKey, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { SliceKey } from '@/engine/animation/types'
import type { ColorGroupGeometry, SliceGroupGeometry, VertexUV } from '@/engine/instancing/voxelMeshBuilder'
import { buildTexturedShellGeometry, buildTexturedShellGeometryByColor, buildTexturedShellGeometryBySliceColor } from '@/engine/instancing/voxelMeshBuilder'
import { atlasUVFor, boxFaceForCell, worldToTexel } from './boxMapping'

/**
 * The box-map UV generator: pick the box face for the cell (chamfer → authored axis; cube → normal),
 * project the vertex onto that face, and place it in the atlas. Shared by the preview and export
 * geometry builders so both sample the identical atlas region. Closes over `gridExtent` since the
 * projection/atlas math scales with the project's own working-cube size.
 */
function uvForExtent(gridExtent: GridExtent): VertexUV {
  return (chamfer, normal, vertex) => {
    const face = boxFaceForCell(chamfer, [normal.x, normal.y, normal.z])
    const [tu, tv] = worldToTexel(face, vertex.x, vertex.y, vertex.z, gridExtent)
    return atlasUVFor(face, tu, tv, gridExtent)
  }
}

/** Box-mapped shell geometry for the Texture-mode 3D preview (single atlas-textured mesh). */
export function buildTexturedGeometry(model: VoxelModel, palette: PaletteState, gridExtent: GridExtent): THREE.BufferGeometry {
  return buildTexturedShellGeometry(model, palette, uvForExtent(gridExtent))
}

/** Box-mapped shell geometry split per (color, emissive class) for GLTF export. */
export function buildTexturedGeometryByColor(model: VoxelModel, palette: PaletteState, gridExtent: GridExtent): ColorGroupGeometry[] {
  return buildTexturedShellGeometryByColor(model, palette, uvForExtent(gridExtent))
}

/** Box-mapped shell geometry split per (color, emissive class, animation slice) for animated GLTF export. */
export function buildTexturedGeometryBySlice(
  model: VoxelModel,
  palette: PaletteState,
  nodeAssignment: Map<CellKey, SliceKey>,
  gridExtent: GridExtent,
): SliceGroupGeometry[] {
  return buildTexturedShellGeometryBySliceColor(model, palette, uvForExtent(gridExtent), nodeAssignment)
}
