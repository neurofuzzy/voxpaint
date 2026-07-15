import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { Axis, VoxelModel, CellKey, GridExtent } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { bakeAOToAtlas, makeSpecularNoiseTexture } from '@/engine/ao/bakeAO'
import { unwrapGeometries } from '@/engine/ao/uvUnwrap'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
import { bakeOverlayTexture } from '@/engine/texture/overlay'
import { buildTexturedGeometryByColor, buildTexturedGeometryBySlice } from '@/engine/texture/texturedGeometry'
import { hasTextureContent } from '@/engine/texture/TextureStore'
import { buildOptimizedVoxelGeometryByMaterial, buildOptimizedVoxelGroupsBySlice } from '@/engine/instancing/voxelMeshBuilder'
import { materialParamsFor, type MaterialClass } from '@/engine/palette/palette'
import { buildEmissiveAnimIndex } from '@/engine/palette/emissiveAnimation'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { assignVoxelsToNodes, hasActiveAnimations, resolveAnimCenter } from '@/engine/animation/animationLayers'
import { buildAllAnimationClips, type AnimNodeInfo } from '@/engine/animation/animationGLTF'
import { registerEmissiveAnimationExtension, type EmissiveAnimExportTarget } from './emissiveAnimationExport'

/**
 * GLTF export pipeline. Replaces the originally-specced `three-bvh-csg` union/weld path: the mesh
 * optimizer (`voxelMeshBuilder.ts`) already unions every cell, culls hidden interior faces, and welds
 * coplanar quads — exactly the clean, non-overlapping manifold GLTF wants.
 *
 * The plain (untextured) PBR path exports the **optimized mesh split into at most four objects, one per
 * material class** (matte/emissive/metal/glass) — never merging classes. Each carries per-vertex
 * colours (`COLOR_0`) and one `MeshPhysicalMaterial` whose params come from `materialParamsFor`
 * (metals `metalness: 1`, glass `transmission: 1` → three emits `KHR_materials_transmission`,
 * emissive gets `emissive` + `emissiveIntensity`). Ambient
 * occlusion is opt-in (`options.ambientOcclusion`): when on, a uv1-unwrapped atlas is baked via 3D
 * hemisphere occupancy sampling and assigned as `material.aoMap` (emits `TEXCOORD_1` + `occlusionTexture`
 * in the .glb).
 *
 * The textured path (a painted box-map exists) keeps the per-(colour) overlay bake: one material per
 * colour with a baked `baseColorTexture`, so `baseColor × map` reproduces the shade/multiply preview.
 * AO is likewise supported via `aoMap` on uv1.
 *
 * Runs on the main thread: the same geometry is built synchronously for the live optimized-mesh
 * preview, and the grid is capped at 64³, so a worker isn't warranted.
 */

export type GltfExportAnchor = 'center' | 'bottom' | 'back'

export type GltfExportOptions = {
  /** Bake ambient occlusion into the exported materials (off by default; the AO algorithm is WIP). */
  ambientOcclusion?: boolean
  /** Intensity of monochromatic noise baked into the AO texture (0–1, default 0 = no noise). */
  noiseLevel?: number
  /** Intensity of specular-colour noise on metal materials (0–1, default 0 = off). */
  specularNoiseLevel?: number
  /** AO strength multiplier (1.0–5.0, default 1.0). */
  aoStrength?: number
  /** Roughness level for glass materials (0–1, default 0.5 = frosted). */
  glassRoughnessLevel?: number
  /** Scale factor as a percentage (1–1000, default 100 = no scaling). */
  scaleFactor?: number
  /** Anchor point: center (default), bottom of extents, or back of extents. */
  anchor?: GltfExportAnchor
  /** Anchor relative to the voxels' own AABB rather than the construction-plane canvas origin
   * (default off, for backward compatibility). Off, `anchor: 'center'` is a no-op — the model
   * exports at its raw canvas-relative position, which is only actually centered if the voxels
   * happen to be painted symmetrically around the canvas origin. On, all three anchors reposition
   * relative to the model's own bounding box, so an off-center paint still exports centered/
   * grounded/backed correctly. */
  alignToObjectBounds?: boolean
  /** Seeds the baked noise/specular grain (`engine/ao/bakeAO.ts`) so this project's noise differs
   * from every other project's at the same voxel coordinates (default 0 = unseeded). Pass
   * `meta.noiseSeed`. */
  noiseSeed?: number
}

const hex6 = (colorKey: number) => colorKey.toString(16).padStart(6, '0')

/**
 * Attach `mesh` to its animation slice node (creating the node on first use, keyed by `sliceKey`)
 * or straight to `root` when unanimated. Geometry vertices carry absolute voxel-grid coordinates,
 * and the slice node sits at the (also absolute) slice pivot — so the mesh is recentered by
 * `-center` here, or the two offsets would stack.
 */
function attachToSliceOrRoot(
  mesh: THREE.Mesh,
  sliceKey: SliceKey | undefined,
  animSettings: Map<SliceKey, SliceAnimSettings> | undefined,
  nodeInfo: Map<SliceKey, { cellKeys: CellKey[]; axis: Axis; offset: number }> | undefined,
  sliceNodes: Map<SliceKey, THREE.Group> | undefined,
  animNodes: AnimNodeInfo[] | undefined,
  root: THREE.Group,
  slicePivots: Map<SliceKey, CellKey> | undefined,
) {
  if (sliceNodes && sliceKey) {
    let node = sliceNodes.get(sliceKey)
    if (!node) {
      node = new THREE.Group()
      const entry = nodeInfo!.get(sliceKey)!
      const settings = animSettings!.get(sliceKey)!
      const center = resolveAnimCenter(entry.cellKeys, entry.axis, entry.offset, settings.animationType, slicePivots)
      if (center) node.position.copy(center)
      node.name = `anim_${sliceKey}`
      sliceNodes.set(sliceKey, node)
      animNodes!.push({ node, sliceKey, settings, axis: entry.axis, center: center ?? new THREE.Vector3() })
    }
    mesh.position.copy(node.position).negate()
    node.add(mesh)
  } else {
    root.add(mesh)
  }
}

function noiseMapTexture(data: Uint8ClampedArray, width: number, height: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, height)
  img.data.set(data)
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.flipY = false
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}
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
  gridExtent: GridExtent,
  texture?: TextureModel,
  options: GltfExportOptions = {},
  animSettings?: Map<SliceKey, SliceAnimSettings>,
  sliceMasks?: Map<SliceKey, Set<CellKey>>,
  slicePivots?: Map<SliceKey, CellKey>,
): Promise<ArrayBuffer> {
  const textured = !!texture && hasTextureContent(texture)
  const root = new THREE.Group()
  root.name = 'VoxPaintModel'
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const geometries: THREE.BufferGeometry[] = []
  const emissiveAnimIndex = buildEmissiveAnimIndex(palette)
  const emissiveAnimTargets: EmissiveAnimExportTarget[] = []

  const hasAnimations = !!animSettings && hasActiveAnimations(animSettings)
  let nodeAssignment: Map<CellKey, SliceKey> | undefined
  let sliceNodeInfo: Map<SliceKey, { cellKeys: CellKey[]; axis: Axis; offset: number }> | undefined
  let animNodes: AnimNodeInfo[] | undefined
  let sliceNodes: Map<SliceKey, THREE.Group> | undefined

  if (hasAnimations) {
    const { nodes } = assignVoxelsToNodes(model, animSettings, sliceMasks)
    sliceNodeInfo = nodes
    nodeAssignment = new Map()
    for (const [sliceKey, entry] of nodes) {
      for (const key of entry.cellKeys) {
        nodeAssignment.set(key, sliceKey)
      }
    }
    animNodes = []
    sliceNodes = new Map()
  }

  // Animated voxels move independently at runtime, so they must not act as AO occluders for the
  // rest of the (baked-once, rest-pose) model — see bakeAOToAtlas calls below.
  const animatedKeys = nodeAssignment ? new Set(nodeAssignment.keys()) : undefined

  if (textured) {
    // Textured overlay path — one baked-texture material per colour (and per animation slice, if any).
    // Glass + KHR_materials_volume + baseColorTexture breaks Mac Preview / Blender;
    // for glass we emit a solid-colour material (no baked map, no unused TEXCOORD_0).
    const groups: Array<{ geometry: THREE.BufferGeometry; colorKey: number; materialClass: MaterialClass; sliceKey?: string }> =
      hasAnimations && nodeAssignment
        ? buildTexturedGeometryBySlice(model, palette, nodeAssignment, gridExtent)
        : buildTexturedGeometryByColor(model, palette, gridExtent).map((g) => ({ ...g, sliceKey: undefined }))
    for (const { geometry } of groups) geometries.push(geometry)

    let aoTex: THREE.DataTexture | null = null
    let metalTex: THREE.Texture | null = null
    let roughTex: THREE.Texture | null = null
    let colorTex: THREE.Texture | null = null
    // Emissive materials skip both AO darkening and the noise grain baked into the same atlas —
    // a glowing surface shouldn't be shadowed or dirtied by either. They still act as occluders for
    // everything else (bakeAOToAtlas samples the full `model`, not the atlas contents), so excluding
    // them here only means they never get an aoMap of their own.
    const aoGroups = groups.filter((g) => g.materialClass !== 'emissive')
    if ((options.ambientOcclusion || (options.specularNoiseLevel ?? 0) > 0) && aoGroups.length > 0) {
      const unwrapped = unwrapGeometries(aoGroups.map((g) => g.geometry))
      for (let i = 0; i < aoGroups.length; i++) {
        aoGroups[i].geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(unwrapped.uv1Arrays[i], 2))
      }
      const baked = bakeAOToAtlas(model, unwrapped.atlas, options.noiseLevel ?? 0, options.aoStrength ?? 1, animatedKeys, options.noiseSeed ?? 0)
      aoTex = aoMapTexture(baked.data, baked.width, baked.height)
      textures.push(aoTex)

      const sl = options.specularNoiseLevel ?? 0
      if (sl > 0) {
        const spec = makeSpecularNoiseTexture(unwrapped.atlas, sl, options.noiseSeed ?? 0)
        metalTex = noiseMapTexture(spec.metalness.data, spec.metalness.width, spec.metalness.height)
        roughTex = noiseMapTexture(spec.roughness.data, spec.roughness.width, spec.roughness.height)
        colorTex = noiseMapTexture(spec.baseColor.data, spec.baseColor.width, spec.baseColor.height)
        colorTex!.colorSpace = THREE.SRGBColorSpace
        textures.push(metalTex!, roughTex!, colorTex!)
      }
    }

    const blend = buildBlendAtlas(texture!, gridExtent)
    for (const { colorKey, materialClass, geometry, sliceKey } of groups) {
      geometry.deleteAttribute('color')
      const params = materialParamsFor(materialClass)

      if (materialClass === 'glass') {
        geometry.deleteAttribute('uv')
        const material = new THREE.MeshPhysicalMaterial({
          color: colorKey,
          vertexColors: false,
          metalness: params.metalness,
          roughness: options.glassRoughnessLevel ?? 0.3,
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
        attachToSliceOrRoot(mesh, sliceKey, animSettings, sliceNodeInfo, sliceNodes, animNodes, root, slicePivots)
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
        if (aoTex && materialClass !== 'emissive') material.aoMap = aoTex
        if (materialClass === 'emissive') {
          material.emissive = new THREE.Color(colorKey)
          material.emissiveIntensity = params.emissiveIntensity
          const animMode = emissiveAnimIndex.get(colorKey)
          if (animMode) emissiveAnimTargets.push({ material, mode: animMode })
        }
        if (materialClass === 'metal') {
          material.specularIntensity = 0
          if (metalTex) material.metalnessMap = metalTex
          if (roughTex) material.roughnessMap = roughTex
        }
        material.name = `voxel_${hex6(colorKey)}_${materialClass}`
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = material.name
        attachToSliceOrRoot(mesh, sliceKey, animSettings, sliceNodeInfo, sliceNodes, animNodes, root, slicePivots)
        materials.push(material)
      }
    }
  } else {
    // PBR path — one solid-colour optimized mesh per (materialClass, colorKey) pair, optional baked AO.
    // When animations exist, groups are further split by slice for per-node assignment.
    let groups: Array<{ geometry: THREE.BufferGeometry; colorKey: number; materialClass: MaterialClass; sliceKey?: string }>

    if (hasAnimations && nodeAssignment) {
      const sliceResult = buildOptimizedVoxelGroupsBySlice(model, palette, nodeAssignment)
      groups = sliceResult.groups
    } else {
      groups = buildOptimizedVoxelGeometryByMaterial(model, palette).map((g) => ({ ...g, sliceKey: undefined }))
    }
    for (const { geometry } of groups) geometries.push(geometry)

    let aoTex: THREE.DataTexture | null = null
    let metalTex: THREE.Texture | null = null
    let roughTex: THREE.Texture | null = null
    let colorTex: THREE.Texture | null = null
    // See the textured path above: emissive materials skip AO/noise entirely.
    const aoGroups = groups.filter((g) => g.materialClass !== 'emissive')
    if ((options.ambientOcclusion || (options.specularNoiseLevel ?? 0) > 0) && aoGroups.length > 0) {
      const unwrapped = unwrapGeometries(aoGroups.map((g) => g.geometry))
      for (let i = 0; i < aoGroups.length; i++) {
        const uv1 = new THREE.Float32BufferAttribute(unwrapped.uv1Arrays[i], 2)
        aoGroups[i].geometry.setAttribute('uv1', uv1)
        aoGroups[i].geometry.setAttribute('uv', uv1)
      }
      const baked = bakeAOToAtlas(model, unwrapped.atlas, options.noiseLevel ?? 0, options.aoStrength ?? 1, animatedKeys, options.noiseSeed ?? 0)
      aoTex = aoMapTexture(baked.data, baked.width, baked.height)
      textures.push(aoTex)

      const sl = options.specularNoiseLevel ?? 0
      if (sl > 0) {
        const spec = makeSpecularNoiseTexture(unwrapped.atlas, sl, options.noiseSeed ?? 0)
        metalTex = noiseMapTexture(spec.metalness.data, spec.metalness.width, spec.metalness.height)
        roughTex = noiseMapTexture(spec.roughness.data, spec.roughness.width, spec.roughness.height)
        colorTex = noiseMapTexture(spec.baseColor.data, spec.baseColor.width, spec.baseColor.height)
        colorTex!.colorSpace = THREE.SRGBColorSpace
        textures.push(metalTex!, roughTex!, colorTex!)
      }
    }

    for (const { materialClass, colorKey, geometry, sliceKey } of groups) {
      const params = materialParamsFor(materialClass)
      const isGlass = materialClass === 'glass'
      const material = new THREE.MeshPhysicalMaterial({
        color: colorKey,
        vertexColors: false,
        metalness: params.metalness,
        roughness: isGlass ? (options.glassRoughnessLevel ?? 0.3) : params.roughness,
        transmission: params.transmission,
      })
      if (params.transmission > 0) {
        material.ior = 1.5
        material.thickness = 0.5
      }
      if (params.emissiveIntensity > 0) {
        material.emissive = new THREE.Color(colorKey)
        material.emissiveIntensity = params.emissiveIntensity
        const animMode = emissiveAnimIndex.get(colorKey)
        if (animMode) emissiveAnimTargets.push({ material, mode: animMode })
      }
      if (aoTex && materialClass !== 'emissive') {
        material.aoMap = aoTex
      }
      if (materialClass === 'metal') {
        material.specularIntensity = 0
        if (metalTex) material.metalnessMap = metalTex
        if (roughTex) material.roughnessMap = roughTex
        if (colorTex) material.map = colorTex
      }
      material.name = `voxel_${hex6(colorKey)}_${materialClass}`
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = material.name
      attachToSliceOrRoot(mesh, sliceKey, animSettings, sliceNodeInfo, sliceNodes, animNodes, root, slicePivots)
      materials.push(material)
    }
  }

  // Attach animated slice nodes to root.
  if (sliceNodes) {
    for (const node of sliceNodes.values()) root.add(node)
  }

  // Build animation clips — GLTFExporter reads these from `options.animations`, not
  // `Object3D.animations` (which it ignores entirely).
  const clips = animNodes && animNodes.length > 0 ? buildAllAnimationClips(animNodes) : []

  const scale = (options.scaleFactor ?? 100) / 100
  const anchor = options.anchor ?? 'center'
  const alignToObjectBounds = options.alignToObjectBounds ?? false
  if (scale !== 1 || anchor !== 'center' || alignToObjectBounds) {
    const box = new THREE.Box3().setFromObject(root)
    root.scale.setScalar(scale)
    if (alignToObjectBounds) {
      // All three axes reposition relative to the voxels' own AABB: the anchor's axis goes flush
      // to its bound (Y=0 for bottom, Z=0 for back), the other two always center on the AABB —
      // so an off-center paint still exports centered/grounded/backed, not canvas-relative.
      const center = box.getCenter(new THREE.Vector3())
      root.position.x = -center.x * scale
      root.position.y = anchor === 'bottom' ? -box.min.y * scale : -center.y * scale
      root.position.z = anchor === 'back' ? -box.min.z * scale : -center.z * scale
    } else if (anchor === 'bottom') {
      root.position.y = -box.min.y * scale
    } else if (anchor === 'back') {
      root.position.z = -box.min.z * scale
    }
  }

  try {
    const exporter = new GLTFExporter()
    registerEmissiveAnimationExtension(exporter, emissiveAnimTargets)
    const result = await exporter.parseAsync(root, { binary: true, animations: clips })
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
