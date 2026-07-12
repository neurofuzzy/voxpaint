import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { buildAtlas } from '@/engine/texture/boxMapping'
import { buildTexturedGeometryByColor } from '@/engine/texture/texturedGeometry'
import { hasTextureContent } from '@/engine/texture/TextureStore'
import { buildOptimizedVoxelGeometryByColor } from '@/engine/instancing/voxelMeshBuilder'

/**
 * GLTF export pipeline. Replaces the originally-specced `three-bvh-csg` union/weld path: the mesh
 * optimizer (`voxelMeshBuilder.ts`) already unions every cell, culls hidden interior faces, and welds
 * coplanar quads — exactly the clean, non-overlapping manifold GLTF wants.
 *
 * Exported as **one mesh + one named material per (palette colour, emissive class)** (not a single
 * vertex-coloured blob): the optimizer already partitions faces this way, so each becomes its own
 * object with a solid `MeshStandardMaterial`, which is what DCC tools like Blender expect (named
 * materials with editable base colours, separable objects) rather than a single default-material mesh.
 *
 * Emissive/blink/pulse slots export with `material.emissive` set to their colour. Static glTF can't
 * animate, so blink and pulse become a **steady** glow (their animation is a live-preview-only effect).
 *
 * Runs on the main thread: the same geometry is built synchronously for the live optimized-mesh
 * preview, and the grid is capped at 64³, so a worker isn't warranted.
 */

const hex6 = (colorKey: number) => colorKey.toString(16).padStart(6, '0')
// Emissive class → material name suffix (0 = none). Mirrors palette.ts's emissiveClassFor.
const EMISSIVE_SUFFIX = ['', '_emissive', '_blink', '_pulse']

/**
 * Build the optimized per-material meshes and serialize them to a binary glTF (.glb) ArrayBuffer.
 * When a non-empty `texture` is supplied, the box-mapped geometry (carrying UVs) is used and the
 * grayscale atlas is embedded as each material's `map` — glTF's `baseColor × map` reproduces the
 * shade/multiply preview exactly. With no texture (or an all-empty one), falls back to the plain
 * per-colour path unchanged.
 */
export async function exportModelToGlb(model: VoxelModel, palette: PaletteState, texture?: TextureModel): Promise<ArrayBuffer> {
  const textured = !!texture && hasTextureContent(texture)
  const groups = textured ? buildTexturedGeometryByColor(model, palette) : buildOptimizedVoxelGeometryByColor(model, palette)

  let atlasTexture: THREE.DataTexture | undefined
  if (textured) {
    const { data, width, height } = buildAtlas(texture!)
    atlasTexture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
    atlasTexture.magFilter = THREE.NearestFilter
    atlasTexture.minFilter = THREE.NearestFilter
    atlasTexture.generateMipmaps = false
    atlasTexture.flipY = false
    atlasTexture.colorSpace = THREE.SRGBColorSpace
    atlasTexture.needsUpdate = true
  }

  const root = new THREE.Group()
  root.name = 'VoxPaintModel'
  const materials: THREE.Material[] = []
  const color = new THREE.Color()

  for (const { colorKey, emissiveClass, geometry } of groups) {
    // The material carries the colour; drop the (redundant, single-colour) vertex attribute so it
    // can't multiply against the base colour in glTF viewers. UVs (when present) are kept for `map`.
    geometry.deleteAttribute('color')

    // Single-sided (the builder winds every face outward); metalness 0 / roughness 1 keeps the
    // low-poly colours reading flat in any viewer.
    const material = new THREE.MeshStandardMaterial({ color: color.setHex(colorKey).clone(), metalness: 0, roughness: 1 })
    if (atlasTexture) material.map = atlasTexture
    if (emissiveClass > 0) {
      material.emissive = color.setHex(colorKey).clone() // steady glow in the slot's own colour
      material.emissiveIntensity = 1
    }
    const name = `voxel_${hex6(colorKey)}${EMISSIVE_SUFFIX[emissiveClass] ?? ''}`
    material.name = name

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    root.add(mesh)
    materials.push(material)
  }

  try {
    const result = await new GLTFExporter().parseAsync(root, { binary: true })
    return result as ArrayBuffer // `binary: true` always resolves to an ArrayBuffer
  } finally {
    for (const { geometry } of groups) geometry.dispose()
    for (const m of materials) m.dispose()
    atlasTexture?.dispose()
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
