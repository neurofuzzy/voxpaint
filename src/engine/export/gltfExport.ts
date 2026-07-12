import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
import { overlayChannel } from '@/engine/texture/overlay'
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

  // Shared blend atlas — each color group bakes its own overlay result from it (below), so the
  // exported material's baseColorTexture already contains overlay(color, blend); no shader needed.
  const blend = textured ? buildBlendAtlas(texture!) : null

  const root = new THREE.Group()
  root.name = 'VoxPaintModel'
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const color = new THREE.Color()

  for (const { colorKey, emissiveClass, geometry } of groups) {
    // Drop the vertex-color attribute either way: the plain path carries colour on the material;
    // the textured path carries it in the baked map. UVs (when present) are kept for `map`.
    geometry.deleteAttribute('color')

    let baseColor: THREE.Color
    let map: THREE.DataTexture | undefined
    if (blend) {
      // Baked overlay carries the colour, so the material base is white × map.
      baseColor = new THREE.Color(0xffffff)
      map = bakeOverlayTexture(blend.data, blend.width, blend.height, colorKey)
      textures.push(map)
    } else {
      baseColor = color.setHex(colorKey).clone()
    }

    // metalness 0 / roughness 1 keeps the low-poly colours reading flat in any viewer.
    const material = new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0, roughness: 1 })
    if (map) material.map = map
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
