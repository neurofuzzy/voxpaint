import type * as THREE from 'three'
import type { CellKey, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { SliceKey } from '@/engine/animation/types'
import type { ColorGroupGeometry, SliceGroupGeometry, TagForTexturedFace, TexturedGroupsResult, UVForTexturedTag, VertexUV } from '@/engine/instancing/voxelMeshBuilder'
import { buildShellGeometryByFacePredicate, buildTexturedShellGeometry, buildTexturedShellGeometryByColor, buildTexturedShellGeometryByColorMerged, buildTexturedShellGeometryBySliceColor } from '@/engine/instancing/voxelMeshBuilder'
import { atlasUVFor, boxFaceForCell, worldToTexel } from './boxMapping'
import { TEXEL_SCALE } from './types'
import type { BoxFace } from './types'

/**
 * The box-map UV generator: pick the box face for the cell (chamfer → authored axis; cube → normal),
 * project the vertex onto that face, and place it in the atlas. Shared by the preview and export
 * geometry builders so both sample the identical atlas region. Closes over `gridExtent` since the
 * projection/atlas math scales with the project's own working-cube size and texel scale.
 */
function uvForExtent(gridExtent: GridExtent, texelScale: number): VertexUV {
  return (chamfer, normal, vertex) => {
    const face = boxFaceForCell(chamfer, [normal.x, normal.y, normal.z])
    const [tu, tv] = worldToTexel(face, vertex.x, vertex.y, vertex.z, gridExtent, texelScale)
    return atlasUVFor(face, tu, tv, gridExtent, texelScale)
  }
}

/** Box-mapped shell geometry for the Texture-mode 3D preview (single atlas-textured mesh). */
export function buildTexturedGeometry(model: VoxelModel, palette: PaletteState, gridExtent: GridExtent, texelScale: number = TEXEL_SCALE): THREE.BufferGeometry {
  return buildTexturedShellGeometry(model, palette, uvForExtent(gridExtent, texelScale))
}

/** Box-mapped shell geometry split per (color, emissive class) for GLTF export. */
export function buildTexturedGeometryByColor(model: VoxelModel, palette: PaletteState, gridExtent: GridExtent, texelScale: number = TEXEL_SCALE): ColorGroupGeometry[] {
  return buildTexturedShellGeometryByColor(model, palette, uvForExtent(gridExtent, texelScale))
}

export function buildTexturedFaceHighlightGeometry(model: VoxelModel, palette: PaletteState, face: BoxFace): THREE.BufferGeometry {
  return buildShellGeometryByFacePredicate(model, palette, (chamfer, normal) => boxFaceForCell(chamfer, [normal.x, normal.y, normal.z]) === face)
}

/**
 * Model-mode preview geometry for textured models: per-(color, material class) groups with an
 * optional tag-aware coplanar merge (gated by the Optimized-mesh toggle), reporting shell vs
 * merged triangle counts for the header stat. The tag and the per-face `uvFor` agree by
 * construction — both resolve the page via `boxFaceForCell` then project via `worldToTexel` /
 * `atlasUVFor` — so merged UVs sample exactly what the unmerged shell would.
 */
export function buildTexturedGeometryByColorMerged(
  model: VoxelModel,
  palette: PaletteState,
  gridExtent: GridExtent,
  mergeCoplanar: boolean,
  texelScale: number = TEXEL_SCALE,
): TexturedGroupsResult {
  const tagFor: TagForTexturedFace = (chamfer, normal) => boxFaceForCell(chamfer, [normal.x, normal.y, normal.z])
  // Sound: this module's tags are always the `boxFaceForCell` page, i.e. a BoxFace.
  const uvForTag: UVForTexturedTag = (tag, vertex) => {
    const face = tag as BoxFace
    const [tu, tv] = worldToTexel(face, vertex.x, vertex.y, vertex.z, gridExtent, texelScale)
    return atlasUVFor(face, tu, tv, gridExtent, texelScale)
  }
  return buildTexturedShellGeometryByColorMerged(model, palette, tagFor, uvForTag, mergeCoplanar)
}

/** Box-mapped shell geometry split per (color, emissive class, animation slice) for animated GLTF export. */
export function buildTexturedGeometryBySlice(
  model: VoxelModel,
  palette: PaletteState,
  nodeAssignment: Map<CellKey, SliceKey>,
  gridExtent: GridExtent,
  texelScale: number = TEXEL_SCALE,
): SliceGroupGeometry[] {
  return buildTexturedShellGeometryBySliceColor(model, palette, uvForExtent(gridExtent, texelScale), nodeAssignment)
}
