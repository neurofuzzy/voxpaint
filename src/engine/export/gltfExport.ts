import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { decodeKey, viewOriginShift } from '@/engine/grid/GridStore'
import { outwardNormal } from '@/engine/plane/planeGeometry'
import type { Axis, VoxelModel, CellKey, Coord, GridExtent, VoxelScaleY } from '@/engine/grid/types'
import type { Marker } from '@/engine/markers/types'
import { markerColorHex, markerNodeName, markerWorldCenter } from '@/engine/markers/markers'
import type { PaletteState } from '@/engine/palette/types'
import { TEXEL_SCALE } from '@/engine/texture/types'
import type { TextureModel } from '@/engine/texture/types'
import { bakeAOToAtlas, makeSpecularNoiseTexture } from '@/engine/ao/bakeAO'
import { unwrapGeometries } from '@/engine/ao/uvUnwrap'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
import { bakeOverlayTexture } from '@/engine/texture/overlay'
import { buildTexturedGeometryByColorMerged, buildTexturedGeometryBySlice } from '@/engine/texture/texturedGeometry'
import { hasTextureContent } from '@/engine/texture/TextureStore'
import { buildOptimizedVoxelGeometryByMaterial, buildOptimizedVoxelGroupsBySlice } from '@/engine/instancing/voxelMeshBuilder'
import { darkestBaseColor, materialParamsFor, type MaterialClass } from '@/engine/palette/palette'
import { buildEmissiveAnimIndex } from '@/engine/palette/emissiveAnimation'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { assignVoxelsToNodes, hasActiveAnimations, resolveAnimCenter } from '@/engine/animation/animationLayers'
import { buildAllAnimationClips, type AnimNodeInfo } from '@/engine/animation/animationGLTF'
import { rigIdForCoord, rigPivotOf, sanitizeRigName, type Pose, type PoseCycle, type RigBox } from '@/engine/rigging/types'
import { bakeRigClips } from '@/engine/rigging/rigLoop'
import { evaluatePoseCycle, poseCycleDuration } from '@/engine/rigging/pose'
import { registerEmissiveAnimationExtension, type EmissiveAnimExportTarget } from './emissiveAnimationExport'
import { scaleGeometryY } from './scaleGeometry'

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
 * With `options.includeTextureMaps: false` both paths emit solid-colour materials + bare geometry:
 * no baked overlay, no `aoMap`, no specular-noise maps, and no `uv`/`uv1` attributes — the .glb
 * contains no images, textures, samplers, or TEXCOORDs.
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
  /** Grain cell size for the noise bakes in atlas texels (1/2/4, default 1 = per-texel). */
  noiseScale?: number
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
    * (default off, for backward compatibility). Off, `anchor: 'center'` keeps the model at its raw
    * canvas-relative position — which is only actually centered if the voxels happen to be painted
    * symmetrically around the canvas origin — except for the half-cell re-base applied to
    * odd-sized projects (see below), which recentres on the visual pillar the views frame.
    * On, all three anchors reposition relative to the model's own bounding box, so an off-center
    * paint still exports centered/grounded/backed correctly. */
  alignToObjectBounds?: boolean
  /** Seeds the baked noise/specular grain (`engine/ao/bakeAO.ts`) so this project's noise differs
   * from every other project's at the same voxel coordinates (default 0 = unseeded). Pass
   * `meta.noiseSeed`. */
  noiseSeed?: number
  /** Texels per voxel of the box-map faces (1/2/4, default 4 = full detail). Pass
   * `meta.texelScale` so UVs sample the project's own face resolution. */
  texelScale?: number
  /** Merge coplanar faces on the PBR (untextured) path (default true). Set false to keep the raw
   * per-voxel surface triangulation — the CSG union still welds cells and drops hidden interior
   * faces, but the exposed surface stays subdivided per voxel so downstream tools can deform the
   * mesh along its original voxel topology. On the textured path this gates the tag-aware
   * coplanar merge instead (same default); the animated textured path always stays per-voxel. */
  optimizeMesh?: boolean
  /** Cull hidden faces between touching voxels (default true). Set false to keep the interface
   * faces between *different* colors/materials: same-color neighbors still weld into one solid
   * exactly as before, but touching parts in different colors keep both sides of the seam so
   * they stay separable downstream (split apart and rig limbs). File grows only by the kept
   * seam faces. The glass-side occlusion cull still runs — a glass face coincident with a kept
   * solid face would z-fight rather than separate. */
  cullInteriorFaces?: boolean
  /** Emit texture maps: the baked color overlay, ambient-occlusion, and metal specular-noise maps
   * (default true). Set false to export materials + geometry only — no `map`/`aoMap`/metalness-map
   * nodes reference any texture, and geometry carries no `uv`/`uv1` attributes, so the .glb
   * contains no images, textures, samplers, or TEXCOORDs at all. */
  includeTextureMaps?: boolean
  /** Project-level Y voxel scale (0.5 = flat, 1 = cubic, 2 = tall; default 1). Baked into the
   * exported vertices after every other bake step (overlay/AO/specular all run in unit-cube voxel
   * units), so the .glb matches the scaled 3D view — see `scaleGeometry.ts`. */
  voxelScaleY?: VoxelScaleY
  /** Design markers to export as empty nodes (default: none). Each becomes one child `Group`
   * under the export root with its label/id in `extras.voxpaint`, so downstream tools can
   * compose external content at those points. Positions are cell centers in the same voxel
   * units as the mesh vertices, inheriting the export scale/anchor via the shared root. */
  markers?: Marker[]
  /** Emit the `markers` as empty nodes (default true). Off skips them — the .glb carries voxels only. */
  includeMarkers?: boolean
  /** Emit animation clips for slice loops, tween stacks, and the pose cycle (default true).
   * Off exports the same joint/node structure posed at bind with no `animations` — useful
   * for downstream tools that can't consume clips or when only the static model matters. */
  includeAnimations?: boolean
  /** Named rig bounding boxes: voxels inside a box export under a `Group` named for the box
   * (deepest containing box wins on overlap, list order breaks ties); voxels outside all
   * boxes export as today. Boxes are model-decoupled bboxes — containment is tested at
   * export time. Rigged voxels are excluded from slice-loop nodes (rig wins) so the joint
   * tree stays independent of procedural animation. */
  rigBoxes?: RigBox[]
}

const hex6 = (colorKey: number) => colorKey.toString(16).padStart(6, '0')

/** Builds the export-time voxel → rig-box assignment (deepest containing box wins). */
export function buildRigAssignment(model: VoxelModel, rigBoxes: RigBox[] | undefined): {
  assignment: Map<CellKey, string> | undefined
  names: Map<string, string>
} {
  if (!rigBoxes || rigBoxes.length === 0) return { assignment: undefined, names: new Map() }
  const assignment = new Map<CellKey, string>()
  const names = new Map<string, string>()
  const used = new Set<string>()
  for (const box of rigBoxes) {
    let base = sanitizeRigName(box.name, `rig_${box.id.slice(0, 8)}`)
    let candidate = base
    let i = 2
    while (used.has(candidate)) candidate = `${base}-${i++}`
    used.add(candidate)
    names.set(box.id, candidate)
  }
  for (const key of model.color.keys()) {
    const rigId = rigIdForCoord(rigBoxes, decodeKey(key))
    if (rigId) assignment.set(key, rigId)
  }
  return { assignment, names }
}

/**
 * Attach `mesh` to its animation slice node (creating the node on first use, keyed by `sliceKey`)
 * or straight to `root` when unanimated. Geometry vertices carry absolute voxel-grid coordinates,
 * and the slice node sits at the (also absolute) slice pivot — so the mesh is recentered by
 * `-center` here, or the two offsets would stack. Both the node position and the clip-baking
 * center are expressed in *scaled* world units (`center.y * voxelScaleY`) to agree with the
 * scale-baked vertices — animation clips author absolute positions around that center.
 *
 * With `rig` set, the mesh instead parents under its prebuilt joint `Group` (see buildRigTree):
 * the joint sits at the rig pivot and the mesh is recentered by `-pivot` — the exact slice
 * pattern, so rotating the joint orbits the part around the authored center and downstream
 * engines can pose the skeleton with plain node TRS (no skinning). Rig joints never nest under
 * slice nodes: rigged voxels are excluded from slice assignment upstream, so rigged meshes
 * always arrive here sliceless and mount straight under the rig tree.
 */
type RigAttachContext = {
  rigId: string
  /** Prebuilt joint groups, keyed by rig id (full outline tree, including empty boxes). */
  groups: Map<string, THREE.Group>
  /** Joint translations in scaled world units, for mesh recentering. */
  scaledPivots: Map<string, THREE.Vector3>
}

/**
 * Builds the poseable joint tree for the rig outline: one `Group` per box (named for it),
 * nested to mirror the outline, each positioned at its pivot *relative to its parent joint*
 * (absolute for roots). Meshes parent under their joint recentered by `-pivot`, so a joint
 * rotation orbits the part around the authored center. Empty boxes still get joints — the tree
 * always mirrors the outline, and an empty parent still poses its children. Dangling and
 * self-referential parents (hand-edited files) fall back to the rig root; the store guarantees
 * acyclic input, and this double-guards it.
 */
function buildRigTree(
  boxes: RigBox[],
  names: Map<string, string>,
  voxelScaleY: number,
): { root: THREE.Group; groups: Map<string, THREE.Group>; scaledPivots: Map<string, THREE.Vector3> } {
  const root = new THREE.Group()
  root.name = 'Rig'
  const groups = new Map<string, THREE.Group>()
  const scaledPivots = new Map<string, THREE.Vector3>()
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const scaled = (p: Coord) => new THREE.Vector3(p[0], p[1] * voxelScaleY, p[2])
  const build = (id: string, chain: Set<string>): THREE.Group => {
    const existing = groups.get(id)
    if (existing) return existing
    const group = new THREE.Group()
    group.name = names.get(id) ?? id
    groups.set(id, group)
    const box = byId.get(id)
    const pivot = box ? scaled(rigPivotOf(box)) : new THREE.Vector3()
    scaledPivots.set(id, pivot)
    const parentId =
      box && box.parentId && box.parentId !== id && !chain.has(box.parentId) && byId.has(box.parentId)
        ? box.parentId
        : null
    if (parentId) {
      const parent = build(parentId, new Set([...chain, id]))
      parent.add(group)
      group.position.copy(pivot).sub(scaledPivots.get(parentId) ?? new THREE.Vector3())
    } else {
      root.add(group)
      group.position.copy(pivot)
    }
    return group
  }
  for (const box of boxes) build(box.id, new Set())
  return { root, groups, scaledPivots }
}

function attachToSliceOrRoot(
  mesh: THREE.Mesh,
  sliceKey: SliceKey | undefined,
  animSettings: Map<SliceKey, SliceAnimSettings> | undefined,
  nodeInfo: Map<SliceKey, { cellKeys: CellKey[]; axis: Axis; offset: number }> | undefined,
  sliceNodes: Map<SliceKey, THREE.Group> | undefined,
  animNodes: AnimNodeInfo[] | undefined,
  root: THREE.Group,
  slicePivots: Map<SliceKey, CellKey> | undefined,
  voxelScaleY: number = 1,
  rig?: RigAttachContext,
) {
  let parent: THREE.Group
  if (sliceNodes && sliceKey) {
    let node = sliceNodes.get(sliceKey)
    if (!node) {
      node = new THREE.Group()
      const entry = nodeInfo!.get(sliceKey)!
      const settings = animSettings!.get(sliceKey)!
      const center = resolveAnimCenter(entry.cellKeys, entry.axis, entry.offset, settings.animationType, slicePivots)
      const scaled = center ? new THREE.Vector3(center.x, center.y * voxelScaleY, center.z) : null
      if (scaled) node.position.copy(scaled)
      node.name = `anim_${sliceKey}`
      sliceNodes.set(sliceKey, node)
      animNodes!.push({ node, sliceKey, settings, axis: entry.axis, center: scaled ?? new THREE.Vector3() })
    }
    parent = node
    mesh.position.copy(node.position).negate()
  } else {
    parent = root
  }
  if (rig) {
    const group = rig.groups.get(rig.rigId)
    if (group) {
      group.add(mesh)
      // Recenter by -pivot (the slice-branch pattern): vertices are absolute, so without this
      // the joint offset and the vertex positions would stack.
      const pivot = rig.scaledPivots.get(rig.rigId)
      if (pivot) mesh.position.copy(pivot).negate()
    } else {
      parent.add(mesh)
    }
  } else {
    parent.add(mesh)
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
  poses?: Pose[],
  poseCycle?: PoseCycle | null,
): Promise<ArrayBuffer> {
  const textured = !!texture && hasTextureContent(texture)
  const root = new THREE.Group()
  root.name = 'VoxPaintModel'
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const geometries: THREE.BufferGeometry[] = []
  const emissiveAnimIndex = buildEmissiveAnimIndex(palette)
  const emissiveAnimTargets: EmissiveAnimExportTarget[] = []

  const includeAnimations = options.includeAnimations ?? true
  const hasAnimations = includeAnimations && !!animSettings && hasActiveAnimations(animSettings)
  let nodeAssignment: Map<CellKey, SliceKey> | undefined
  let sliceNodeInfo: Map<SliceKey, { cellKeys: CellKey[]; axis: Axis; offset: number }> | undefined
  let animNodes: AnimNodeInfo[] | undefined
  let sliceNodes: Map<SliceKey, THREE.Group> | undefined

  if (hasAnimations) {
    const { nodes } = assignVoxelsToNodes(model, animSettings, sliceMasks, options.rigBoxes)
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

  // Animated voxels move independently at runtime, so they must not act as AO occluders for
  // the rest of the (baked-once, rest-pose) model — see bakeAOToAtlas calls below. Rigged
  // voxels join the exclusion for the same reason: joints are externally poseable, so a
  // rotated joint would otherwise drag a stale baked shadow with it (and leave a phantom
  // one behind).
  const animatedKeys = new Set<CellKey>(nodeAssignment ? nodeAssignment.keys() : [])
  // Named rig boxes: deepest-box-wins containment tested at export time (model-decoupled).
  // Rigged voxels are excluded from slice assignment above (rig wins), so joint meshes never
  // land under slice nodes — the tree mounts at the root under one Rig container instead.
  const { assignment: rigAssignment, names: rigNames } = buildRigAssignment(model, options.rigBoxes)
  if (rigAssignment) {
    for (const key of rigAssignment.keys()) animatedKeys.add(key)
  }
  const rigTree =
    options.rigBoxes && options.rigBoxes.length > 0
      ? buildRigTree(options.rigBoxes, rigNames, options.voxelScaleY ?? 1)
      : null
  if (rigTree) root.add(rigTree.root)
  const rigContextFor = (rigId: string | undefined): RigAttachContext | undefined => {
    if (!rigId || !rigTree || !rigTree.groups.has(rigId)) return undefined
    return { rigId, groups: rigTree.groups, scaledPivots: rigTree.scaledPivots }
  }
  const meshDisplayName = (rigId: string | undefined, colorKey: number, materialClass: MaterialClass) => {
    const rigName = rigId ? rigNames.get(rigId) : undefined
    return rigName ? `${rigName}_${hex6(colorKey)}_${materialClass}` : `voxel_${hex6(colorKey)}_${materialClass}`
  }

  // Map-free export: solid materials + bare geometry, no uv attributes (the exporter turns any
  // `uv`/`uv1` attribute into TEXCOORDs), so the .glb carries no images/textures/samplers.
  const includeTextureMaps = options.includeTextureMaps ?? true
  const stripUVs = (list: Array<{ geometry: THREE.BufferGeometry }>) => {
    for (const { geometry } of list) {
      geometry.deleteAttribute('uv')
      geometry.deleteAttribute('uv1')
    }
  }
  // Project-level Y voxel scale, baked into vertices as the final geometry step (after every
  // bake above, before anchors below) — see `scaleGeometry.ts`.
  const voxelScaleY = options.voxelScaleY ?? 1
  const bakeScaleY = (list: Array<{ geometry: THREE.BufferGeometry }>) => {
    for (const { geometry } of list) scaleGeometryY(geometry, voxelScaleY)
  }

  if (textured) {
    // Textured overlay path — one baked-texture material per colour (and per animation slice, if any).
    // Glass + KHR_materials_volume + baseColorTexture breaks Mac Preview / Blender;
    // for glass we emit a solid-colour material (no baked map, no unused TEXCOORD_0).
    const texelScale = options.texelScale ?? TEXEL_SCALE
    const cullInteriorFaces = options.cullInteriorFaces ?? true
    const groups: Array<{ geometry: THREE.BufferGeometry; colorKey: number; materialClass: MaterialClass; sliceKey?: string; rigId?: string }> =
      hasAnimations && nodeAssignment
        ? buildTexturedGeometryBySlice(model, palette, nodeAssignment, gridExtent, texelScale, cullInteriorFaces, rigAssignment)
        : buildTexturedGeometryByColorMerged(model, palette, gridExtent, options.optimizeMesh ?? true, texelScale, cullInteriorFaces, rigAssignment).groups.map((g) => ({ ...g, sliceKey: undefined }))
    for (const { geometry } of groups) geometries.push(geometry)
    if (!includeTextureMaps) stripUVs(groups)

    let aoTex: THREE.DataTexture | null = null
    let metalTex: THREE.Texture | null = null
    let roughTex: THREE.Texture | null = null
    let colorTex: THREE.Texture | null = null
    // Emissive materials skip both AO darkening and the noise grain baked into the same atlas —
    // a glowing surface shouldn't be shadowed or dirtied by either. They still act as occluders for
    // everything else (bakeAOToAtlas samples the full `model`, not the atlas contents), so excluding
    // them here only means they never get an aoMap of their own.
    const aoGroups = groups.filter((g) => g.materialClass !== 'emissive')
    // AO maps are independently excludable (`options.ambientOcclusion`); specular-noise maps
    // still bake when requested even with AO off (they share the unwrap atlas, not the AO bake).
    // The monochromatic noise grain lives inside the AO atlas, so it must bake whenever
    // `noiseLevel > 0` even with AO off — matching the live preview (`usePreviewAOMaps`), which
    // shows noise with AO off. Otherwise the export silently drops the noise the preview shows.
    const wantAO = includeTextureMaps && !!options.ambientOcclusion && aoGroups.length > 0
    const wantNoise = includeTextureMaps && (options.noiseLevel ?? 0) > 0 && aoGroups.length > 0
    const specularLevel = options.specularNoiseLevel ?? 0
    if (includeTextureMaps && (wantAO || wantNoise || specularLevel > 0) && aoGroups.length > 0) {
      const unwrapped = unwrapGeometries(aoGroups.map((g) => g.geometry))
      for (let i = 0; i < aoGroups.length; i++) {
        aoGroups[i].geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(unwrapped.uv1Arrays[i], 2))
      }
      if (wantAO || wantNoise) {
        // Preview parity: with AO off but noise on, the bake still runs (strength 1, as in the
        // preview) so the grain exports instead of vanishing.
        const effectiveAo = options.ambientOcclusion ? (options.aoStrength ?? 1) : 1
        const baked = bakeAOToAtlas(model, unwrapped.atlas, options.noiseLevel ?? 0, effectiveAo, animatedKeys, options.noiseSeed ?? 0, options.noiseScale ?? 1)
        aoTex = aoMapTexture(baked.data, baked.width, baked.height)
        textures.push(aoTex)
      }

      const sl = specularLevel
      if (sl > 0) {
        const spec = makeSpecularNoiseTexture(unwrapped.atlas, sl, options.noiseSeed ?? 0, options.noiseScale ?? 1)
        metalTex = noiseMapTexture(spec.metalness.data, spec.metalness.width, spec.metalness.height)
        roughTex = noiseMapTexture(spec.roughness.data, spec.roughness.width, spec.roughness.height)
        colorTex = noiseMapTexture(spec.baseColor.data, spec.baseColor.width, spec.baseColor.height)
        colorTex!.colorSpace = THREE.SRGBColorSpace
        textures.push(metalTex!, roughTex!, colorTex!)
      }
    }

    const blend = includeTextureMaps ? buildBlendAtlas(texture!, gridExtent, texelScale) : null
    // Y-scale bakes after the AO/unwrap work above (unit-cube voxel units) and before meshes —
    // anchors below then operate on true scaled extents.
    bakeScaleY(groups)
    for (const { colorKey, materialClass, geometry, sliceKey, rigId } of groups) {
      geometry.deleteAttribute('color')
      const params = materialParamsFor(materialClass)

      if (materialClass === 'glass' || !includeTextureMaps) {
        // Glass never takes a baked map (it breaks Mac Preview / Blender); map-free export uses
        // the same solid-colour material for every class.
        if (materialClass === 'glass') geometry.deleteAttribute('uv')
        const material = new THREE.MeshPhysicalMaterial({
          color: colorKey,
          vertexColors: false,
          metalness: params.metalness,
          roughness: materialClass === 'glass' ? (options.glassRoughnessLevel ?? 0.3) : params.roughness,
          transmission: params.transmission,
        })
        if (params.transmission > 0) {
          material.ior = 1.5
          material.thickness = 0.5
        }
        if (aoTex) material.aoMap = aoTex
        if (params.emissiveIntensity > 0) {
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
        material.name = meshDisplayName(rigId, colorKey, materialClass)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = material.name
        attachToSliceOrRoot(mesh, sliceKey, animSettings, sliceNodeInfo, sliceNodes, animNodes, root, slicePivots, voxelScaleY, rigContextFor(rigId))
        materials.push(material)
      } else {
        const map = bakeOverlayTexture(blend!.data, blend!.width, blend!.height, colorKey)
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
        material.name = meshDisplayName(rigId, colorKey, materialClass)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = material.name
        attachToSliceOrRoot(mesh, sliceKey, animSettings, sliceNodeInfo, sliceNodes, animNodes, root, slicePivots, voxelScaleY, rigContextFor(rigId))
        materials.push(material)
      }
    }
  } else {
    // PBR path — one solid-colour optimized mesh per (materialClass, colorKey) pair, optional baked AO.
    // When animations exist, groups are further split by slice for per-node assignment.
    // Rig boxes split every group once more (same material + same box weld; different boxes never weld).
    let groups: Array<{ geometry: THREE.BufferGeometry; colorKey: number; materialClass: MaterialClass; sliceKey?: string; rigId?: string }>

    const mergeCoplanar = options.optimizeMesh ?? true
    const cullInteriorFaces = options.cullInteriorFaces ?? true
    if (hasAnimations && nodeAssignment) {
      const sliceResult = buildOptimizedVoxelGroupsBySlice(model, palette, nodeAssignment, mergeCoplanar, cullInteriorFaces, rigAssignment)
      groups = sliceResult.groups
    } else {
      groups = buildOptimizedVoxelGeometryByMaterial(model, palette, mergeCoplanar, cullInteriorFaces, rigAssignment).map((g) => ({ ...g, sliceKey: undefined }))
    }
    for (const { geometry } of groups) geometries.push(geometry)
    if (!includeTextureMaps) stripUVs(groups)

    let aoTex: THREE.DataTexture | null = null
    let metalTex: THREE.Texture | null = null
    let roughTex: THREE.Texture | null = null
    let colorTex: THREE.Texture | null = null
    // See the textured path above: emissive materials skip AO/noise entirely.
    const aoGroups = groups.filter((g) => g.materialClass !== 'emissive')
    const wantAO = includeTextureMaps && !!options.ambientOcclusion && aoGroups.length > 0
    const wantNoise = includeTextureMaps && (options.noiseLevel ?? 0) > 0 && aoGroups.length > 0
    const specularLevel = options.specularNoiseLevel ?? 0
    if (includeTextureMaps && (wantAO || wantNoise || specularLevel > 0) && aoGroups.length > 0) {
      const unwrapped = unwrapGeometries(aoGroups.map((g) => g.geometry))
      for (let i = 0; i < aoGroups.length; i++) {
        const uv1 = new THREE.Float32BufferAttribute(unwrapped.uv1Arrays[i], 2)
        aoGroups[i].geometry.setAttribute('uv1', uv1)
        aoGroups[i].geometry.setAttribute('uv', uv1)
      }
      if (wantAO || wantNoise) {
        // Preview parity — see the textured path above: noise must bake even with AO off.
        const effectiveAo = options.ambientOcclusion ? (options.aoStrength ?? 1) : 1
        const baked = bakeAOToAtlas(model, unwrapped.atlas, options.noiseLevel ?? 0, effectiveAo, animatedKeys, options.noiseSeed ?? 0, options.noiseScale ?? 1)
        aoTex = aoMapTexture(baked.data, baked.width, baked.height)
        textures.push(aoTex)
      }

      const sl = specularLevel
      if (sl > 0) {
        const spec = makeSpecularNoiseTexture(unwrapped.atlas, sl, options.noiseSeed ?? 0, options.noiseScale ?? 1)
        metalTex = noiseMapTexture(spec.metalness.data, spec.metalness.width, spec.metalness.height)
        roughTex = noiseMapTexture(spec.roughness.data, spec.roughness.width, spec.roughness.height)
        colorTex = noiseMapTexture(spec.baseColor.data, spec.baseColor.width, spec.baseColor.height)
        colorTex!.colorSpace = THREE.SRGBColorSpace
        textures.push(metalTex!, roughTex!, colorTex!)
      }
    }

    bakeScaleY(groups)
    for (const { materialClass, colorKey, geometry, sliceKey, rigId } of groups) {
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
      material.name = meshDisplayName(rigId, colorKey, materialClass)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = material.name
      attachToSliceOrRoot(mesh, sliceKey, animSettings, sliceNodeInfo, sliceNodes, animNodes, root, slicePivots, voxelScaleY, rigContextFor(rigId))
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
  // Tween stacks (+ the pose cycle, when one is defined) bake to one looping clip per
  // animated joint (sampled over the universal cycle, authored in the parent's animated
  // frame — see `bakeRigClips`). The cycle definition bakes from its top regardless of
  // transport state, so export is deterministic. With `includeAnimations: false` the
  // joint/node structure still exports, posed at bind.
  if (rigTree && includeAnimations) {
    const boxes = options.rigBoxes ?? []
    const cycle = poseCycle ?? null
    const poseBake = cycle
      ? { at: (t: number) => evaluatePoseCycle(poses ?? [], cycle, t) ?? new Map(), duration: poseCycleDuration(cycle) }
      : undefined
    clips.push(...bakeRigClips(boxes, rigTree.groups, voxelScaleY, 30, poseBake))
  }

  const scale = (options.scaleFactor ?? 100) / 100
  const anchor = options.anchor ?? 'center'
  const alignToObjectBounds = options.alignToObjectBounds ?? false
  // Odd project sizes work on an even effective grid whose volume is centred on the world origin,
  // but the 2D/3D views frame the centre *pillar* (cell [0,0,0], centred at +0.5) dead-centre via
  // `viewOriginShift`. Re-base the export on that same visual origin so a pillar-centred model
  // exports centred on the GLTF origin instead of 0.5 voxels off. Zero for even sizes, so the
  // formulas below reduce exactly to the previous behaviour there.
  const shift = viewOriginShift(gridExtent)
  if (scale !== 1 || anchor !== 'center' || alignToObjectBounds || shift !== 0) {
    const box = new THREE.Box3().setFromObject(root)
    root.scale.setScalar(scale)
    if (alignToObjectBounds) {
      // All three axes reposition relative to the voxels' own AABB: the anchor's axis goes flush
      // to its bound (Y=0 for bottom, Z=0 for back), the other two always center on the AABB —
      // so an off-center paint still exports centered/grounded/backed, not canvas-relative.
      // AABB-relative, so the odd-size visual-origin shift below does not apply here: centring
      // the measured bounds is already correct for even and odd sizes alike.
      const center = box.getCenter(new THREE.Vector3())
      root.position.x = -center.x * scale
      root.position.y = anchor === 'bottom' ? -box.min.y * scale : -center.y * scale
      root.position.z = anchor === 'back' ? -box.min.z * scale : -center.z * scale
    } else if (anchor === 'bottom') {
      root.position.set(-shift * scale, -box.min.y * scale, -shift * scale)
    } else if (anchor === 'back') {
      root.position.set(-shift * scale, -shift * scale, -box.min.z * scale)
    } else {
      root.position.set(-shift * scale, -shift * scale, -shift * scale)
    }
  }

  // Design markers — one empty node per marker, parented under root so each inherits the
  // export scale/anchor transform above (local positions stay in pre-scale voxel units, exactly
  // like the mesh vertices). Added AFTER the anchor block so marker positions never expand the
  // measured voxel AABB: anchors stay voxel-pure (a landscaping marker off to the side must not
  // recenter the model). The node is rotated so its local +Z points along the marker's draw-time
  // outward normal, meaning content composed onto the node downstream faces away from the drawn
  // surface. The exporter serializes `userData` into the node's `extras`
  // (GLTFExporter.serializeUserData), giving downstream tools a stable lookup: nodes whose
  // `extras.voxpaint.kind === 'marker'`, carrying color hex plus the draw-time basis.
  if (options.includeMarkers ?? true) {
    const taken = new Set<string>()
    const forward = new THREE.Vector3(0, 0, 1)
    for (const marker of options.markers ?? []) {
      const node = new THREE.Group()
      node.name = markerNodeName(marker, taken)
      const [x, y, z] = markerWorldCenter(marker.position, voxelScaleY)
      node.position.set(x, y, z)
      const outward = outwardNormal(marker.planeAxis, marker.planeOrientation)
      node.quaternion.setFromUnitVectors(forward, new THREE.Vector3(outward[0], outward[1], outward[2]))
      node.userData = {
        voxpaint: {
          kind: 'marker',
          id: marker.id,
          color: markerColorHex(marker.color),
          axis: marker.planeAxis,
          orientation: marker.planeOrientation,
        },
      }
      root.add(node)
    }
  }

  try {
    const exporter = new GLTFExporter()
    registerEmissiveAnimationExtension(exporter, emissiveAnimTargets, new THREE.Color(darkestBaseColor(palette)))
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
