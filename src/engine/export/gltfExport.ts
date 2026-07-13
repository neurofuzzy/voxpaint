import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { bakeAOAtlas } from '@/engine/ao/bakeAO'
import { atlasUVForVertex, buildBlendAtlas } from '@/engine/texture/boxMapping'
import { overlayChannel } from '@/engine/texture/overlay'
import { buildTexturedGeometryByColor } from '@/engine/texture/texturedGeometry'
import { hasTextureContent } from '@/engine/texture/TextureStore'
import { buildOptimizedVoxelGeometryByMaterial } from '@/engine/instancing/voxelMeshBuilder'
import { materialParamsFor } from '@/engine/palette/palette'

/**
 * GLTF export pipeline. Replaces the originally-specced `three-bvh-csg` union/weld path: the mesh
 * optimizer (`voxelMeshBuilder.ts`) already unions every cell, culls hidden interior faces, and welds
 * coplanar quads — exactly the clean, non-overlapping manifold GLTF wants.
 *
 * The plain (untextured) PBR path exports the **optimized mesh split into at most four objects, one per
 * material class** (matte/emissive/metal/glass) — never merging classes. Each carries per-vertex
 * colours (`COLOR_0`) and one `MeshPhysicalMaterial` whose params come from `materialParamsFor`
 * (metals `metalness: 1`, glass `transmission: 1` → three emits `KHR_materials_transmission`). Ambient
 * occlusion is opt-in (`options.ambientOcclusion`): when on, the baked AO atlas is embedded as each
 * material's `map` (so `baseColour × COLOR_0 × ao`). Emissive glow is **not** exported — glTF can't hold
 * a per-vertex emissive colour in a single material (the preview shows it); revisit with an emissive map.
 *
 * The textured path (a painted box-map exists) keeps the per-(colour) overlay bake: one material per
 * colour with a baked `baseColorTexture`, so `baseColor × map` reproduces the shade/multiply preview.
 *
 * Runs on the main thread: the same geometry is built synchronously for the live optimized-mesh
 * preview, and the grid is capped at 64³, so a worker isn't warranted.
 */

export type GltfExportOptions = {
  /** Bake ambient occlusion into the exported materials (off by default; the AO algorithm is WIP). */
  ambientOcclusion?: boolean
}

const hex6 = (colorKey: number) => colorKey.toString(16).padStart(6, '0')

/**
 * Bake `overlay(color, blend)` into an sRGB RGBA texture for one color group. `blendData` is the
 * shared blend atlas (R = blend·255); `colorKey` is the group's packed sRGB color. The result is a
 * standard `baseColorTexture` (with `baseColorFactor` = white), so any glTF viewer reproduces the
 * in-app overlay preview with no custom shader.
 */
function bakeOverlayTexture(blendData: Uint8ClampedArray, width: number, height: number, colorKey: number): THREE.DataTexture {
  const r = ((colorKey >> 16) & 255) / 255
  const g = ((colorKey >> 8) & 255) / 255
  const b = (colorKey & 255) / 255
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const blend = blendData[i * 4] / 255
    out[i * 4] = overlayChannel(r, blend) * 255
    out[i * 4 + 1] = overlayChannel(g, blend) * 255
    out[i * 4 + 2] = overlayChannel(b, blend) * 255
    out[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(out, width, height, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.flipY = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Wrap a baked AO atlas as a raw (non-colour) `map` texture. */
function aoMapTexture(data: Uint8ClampedArray, width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.flipY = false
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/** Set per-vertex box-map atlas UVs on an optimized geometry (from each vertex's position + normal). */
function assignAtlasUVs(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const nrm = geometry.getAttribute('normal') as THREE.BufferAttribute
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = atlasUVForVertex([nrm.getX(i), nrm.getY(i), nrm.getZ(i)], pos.getX(i), pos.getY(i), pos.getZ(i))
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
}

/**
 * Build the export scene and serialize it to a binary glTF (.glb) ArrayBuffer. Untextured models take
 * the PBR path (≤4 vertex-coloured meshes, one per material class, with optional baked AO); painted
 * models take the textured overlay path (one baked-texture material per colour).
 */
export async function exportModelToGlb(
  model: VoxelModel,
  palette: PaletteState,
  texture?: TextureModel,
  options: GltfExportOptions = {},
): Promise<ArrayBuffer> {
  const textured = !!texture && hasTextureContent(texture)
  const root = new THREE.Group()
  root.name = 'VoxPaintModel'
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const geometries: THREE.BufferGeometry[] = []

  if (textured) {
    // Textured overlay path — one baked-texture material per colour (unchanged).
    const groups = buildTexturedGeometryByColor(model, palette)
    const blend = buildBlendAtlas(texture!)
    for (const { colorKey, materialClass, geometry } of groups) {
      geometry.deleteAttribute('color') // colour is carried by the baked map
      geometries.push(geometry)
      const map = bakeOverlayTexture(blend.data, blend.width, blend.height, colorKey)
      textures.push(map)
      const params = materialParamsFor(materialClass)
      const material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map,
        metalness: params.metalness,
        roughness: params.roughness,
        transmission: params.transmission,
      })
      if (params.transmission > 0) {
        material.ior = 1.5
        material.thickness = 0.5
      }
      material.name = `voxel_${hex6(colorKey)}_${materialClass}`
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = material.name
      root.add(mesh)
      materials.push(material)
    }
  } else {
    // PBR path — one solid-colour optimized mesh per (materialClass, colorKey) pair, optional baked AO.
    const groups = buildOptimizedVoxelGeometryByMaterial(model, palette)
    const ao = options.ambientOcclusion ? bakeAOAtlas(model) : null
    const aoTex = ao ? aoMapTexture(ao.data, ao.width, ao.height) : null
    if (aoTex) textures.push(aoTex)

    for (const { materialClass, colorKey, geometry } of groups) {
      geometries.push(geometry)
      const params = materialParamsFor(materialClass)
      const material = new THREE.MeshPhysicalMaterial({
        color: colorKey,
        vertexColors: false,
        metalness: params.metalness,
        roughness: params.roughness,
        transmission: params.transmission,
      })
      if (params.transmission > 0) {
        material.ior = 1.5
        material.thickness = 0.5
      }
      if (params.emissiveIntensity > 0) {
        material.emissive = new THREE.Color(colorKey)
        material.emissiveIntensity = params.emissiveIntensity
      }
      if (aoTex) {
        assignAtlasUVs(geometry)
        material.map = aoTex
      }
      material.name = `voxel_${hex6(colorKey)}_${materialClass}`
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = material.name
      root.add(mesh)
      materials.push(material)
    }
  }

  try {
    const result = await new GLTFExporter().parseAsync(root, { binary: true })
    return result as ArrayBuffer // `binary: true` always resolves to an ArrayBuffer
  } finally {
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
    for (const t of textures) t.dispose()
  }
}

/** Trigger a browser download of a .glb ArrayBuffer. */
export function downloadGlb(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.glb') ? filename : `${filename}.glb`
  a.click()
  URL.revokeObjectURL(url)
}
