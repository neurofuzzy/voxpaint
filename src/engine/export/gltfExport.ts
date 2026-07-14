import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { bakeAOToAtlas } from '@/engine/ao/bakeAO'
import { unwrapGeometries } from '@/engine/ao/uvUnwrap'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
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
 * occlusion is opt-in (`options.ambientOcclusion`): when on, a uv1-unwrapped atlas is baked via 3D
 * hemisphere occupancy sampling and assigned as `material.aoMap` (emits `TEXCOORD_1` + `occlusionTexture`
 * in the .glb). Emissive glow is **not** exported — glTF can't hold a per-vertex emissive colour in a
 * single material (the preview shows it); revisit with an emissive map.
 *
 * The textured path (a painted box-map exists) keeps the per-(colour) overlay bake: one material per
 * colour with a baked `baseColorTexture`, so `baseColor × map` reproduces the shade/multiply preview.
 * AO is likewise supported via `aoMap` on uv1.
 *
 * Runs on the main thread: the same geometry is built synchronously for the live optimized-mesh
 * preview, and the grid is capped at 64³, so a worker isn't warranted.
 */

export type GltfExportOptions = {
  /** Bake ambient occlusion into the exported materials (off by default; the AO algorithm is WIP). */
  ambientOcclusion?: boolean
  /** Intensity of monochromatic noise baked into the AO texture (0–1, default 0 = no noise). */
  noiseLevel?: number
  /** AO strength multiplier (1.0–5.0, default 1.0). */
  aoStrength?: number
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

/** Wrap a baked AO atlas as a raw (non-colour) `aoMap` texture on uv channel 1. */
function aoMapTexture(data: Uint8ClampedArray, width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.flipY = false
  tex.colorSpace = THREE.NoColorSpace
  tex.channel = 1
  tex.needsUpdate = true
  return tex
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
    // Textured overlay path — one baked-texture material per colour.
    // Glass + KHR_materials_volume + baseColorTexture breaks Mac Preview / Blender;
    // for glass we emit a solid-colour material (no baked map, no unused TEXCOORD_0).
    const groups = buildTexturedGeometryByColor(model, palette)
    for (const { geometry } of groups) geometries.push(geometry)

    let aoTex: THREE.DataTexture | null = null
    if (options.ambientOcclusion && groups.length > 0) {
      const unwrapped = unwrapGeometries(groups.map((g) => g.geometry))
      for (let i = 0; i < groups.length; i++) {
        groups[i].geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(unwrapped.uv1Arrays[i], 2))
      }
      const baked = bakeAOToAtlas(model, unwrapped.atlas, options.noiseLevel ?? 0, options.aoStrength ?? 1)
      aoTex = aoMapTexture(baked.data, baked.width, baked.height)
      textures.push(aoTex)
    }

    const blend = buildBlendAtlas(texture!)
    for (const { colorKey, materialClass, geometry } of groups) {
      geometry.deleteAttribute('color')
      const params = materialParamsFor(materialClass)

      if (materialClass === 'glass') {
        geometry.deleteAttribute('uv')
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
        if (aoTex) material.aoMap = aoTex
        material.name = `voxel_${hex6(colorKey)}_${materialClass}`
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = material.name
        root.add(mesh)
        materials.push(material)
      } else {
        const map = bakeOverlayTexture(blend.data, blend.width, blend.height, colorKey)
        textures.push(map)
        const material = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          map,
          metalness: params.metalness,
          roughness: params.roughness,
          transmission: params.transmission,
        })
        if (aoTex) material.aoMap = aoTex
        material.name = `voxel_${hex6(colorKey)}_${materialClass}`
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = material.name
        root.add(mesh)
        materials.push(material)
      }
    }
  } else {
    // PBR path — one solid-colour optimized mesh per (materialClass, colorKey) pair, optional baked AO.
    const groups = buildOptimizedVoxelGeometryByMaterial(model, palette)
    for (const { geometry } of groups) geometries.push(geometry)

    let aoTex: THREE.DataTexture | null = null
    if (options.ambientOcclusion) {
      const unwrapped = unwrapGeometries(groups.map((g) => g.geometry))
      for (let i = 0; i < groups.length; i++) {
        groups[i].geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(unwrapped.uv1Arrays[i], 2))
      }
      const baked = bakeAOToAtlas(model, unwrapped.atlas, options.noiseLevel ?? 0, options.aoStrength ?? 1)
      aoTex = aoMapTexture(baked.data, baked.width, baked.height)
      textures.push(aoTex)
    }

    for (const { materialClass, colorKey, geometry } of groups) {
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
        material.aoMap = aoTex
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
