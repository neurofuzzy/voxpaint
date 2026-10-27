import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
import { MARKER_COLORS } from '@/engine/markers/types'
import { defaultAnimationSettings, encodeSliceKey } from '@/engine/animation/animationLayers'
import { exportModelToGlb } from './gltfExport'

// three's GLTFExporter rasterizes every texture image through a 2D canvas — also absent in
// node. Minimal stub supporting only the DataTexture path maps-on exports take (aoMap): the
// exporter copies image bytes via putImageData, then blobs the canvas for the binary chunk.
// Pixel fidelity is irrelevant here (tests only read the JSON chunk), so toBlob emits filler.
if (typeof (globalThis as Record<string, unknown>).document === 'undefined') {
  class StubCanvasContext {
    translate() { /* no-op */ }
    scale() { /* no-op */ }
    putImageData() { /* no-op */ }
  }
  class StubCanvas {
    width = 1
    height = 1
    getContext() {
      return new StubCanvasContext()
    }
    toBlob(cb: (blob: Blob | null) => void) {
      cb(new Blob(['stub'], { type: 'image/png' }))
    }
  }
  class StubImageData {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data
      this.width = width
      this.height = height
    }
  }
  const g = globalThis as Record<string, unknown>
  g.document = { createElement: () => new StubCanvas() }
  g.ImageData = StubImageData
}
// Binary .glb assembly via Blob + FileReader — the ArrayBuffer path the exporter uses.
if (typeof (globalThis as Record<string, unknown>).FileReader === 'undefined') {
  class NodeFileReader {
    result: ArrayBuffer | null = null
    onloadend: (() => void) | null = null
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf.slice(0)
        this.onloadend?.()
      })
    }
  }
  ;(globalThis as Record<string, unknown>).FileReader = NodeFileReader
}

const base0: PaletteSlotRef = { kind: 'base', index: 0 }

/** A single pillar voxel at the grid origin — the cell the views frame dead-centre. */
function pillarVoxel(): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
  return { ...model, bounds: recomputeBounds(model) }
}

interface GlbJson {
  nodes?: Array<{ name?: string; translation?: [number, number, number]; matrix?: number[]; rotation?: [number, number, number, number]; extras?: { voxpaint?: { kind?: string; id?: string; color?: string; axis?: string; orientation?: number } } }>
  images?: unknown[]
  textures?: unknown[]
  samplers?: unknown[]
  accessors?: Array<{ count?: number }>
  materials?: Array<{
    name?: string
    baseColorTexture?: unknown
    metallicRoughnessTexture?: unknown
    occlusionTexture?: unknown
    emissiveTexture?: unknown
    normalTexture?: unknown
    pbrMetallicRoughness?: { baseColorFactor?: number[] }
  }>
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>
  animations?: Array<{
    name?: string
    channels?: Array<{ sampler?: number; target?: { node?: number; path?: string } }>
    samplers?: Array<{ interpolation?: string }>
  }>
}

/** Parse the JSON chunk out of a binary .glb buffer. */
function glbJson(buffer: ArrayBuffer): GlbJson {
  const view = new DataView(buffer)
  expect(view.getUint32(0, true)).toBe(0x46546c67) // 'glTF' magic
  const jsonLength = view.getUint32(12, true)
  const jsonBytes = new Uint8Array(buffer, 20, jsonLength)
  return JSON.parse(new TextDecoder().decode(jsonBytes)) as GlbJson
}

/** Translation of the named export-root node (absent = identity, i.e. unshifted). The exporter
 * may emit it as TRS `translation` or as a column-major `matrix` — read either. */
function rootTranslation(json: GlbJson): [number, number, number] {
  const node = json.nodes?.find((n) => n.name === 'VoxPaintModel')
  expect(node).toBeDefined()
  if (node!.translation) return node!.translation
  if (node!.matrix) return [node!.matrix[12], node!.matrix[13], node!.matrix[14]]
  return [0, 0, 0]
}

/** Local +Z rotated by a glTF (x, y, z, w) quaternion — the node's facing direction. */
function quatRotateZ(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q
  return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]
}

describe('exportModelToGlb odd-extent centering', () => {
  it('exports the pillar voxel centred on the origin for an odd project size', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 9)
    const t = rootTranslation(glbJson(glb))
    // The views frame the pillar (cell [0,0,0], centred at +0.5) dead-centre, so the export
    // re-bases by the half-cell view shift: raw [0,1) voxels land on [-0.5,0.5).
    expect(t[0]).toBeCloseTo(-0.5, 4)
    expect(t[1]).toBeCloseTo(-0.5, 4)
    expect(t[2]).toBeCloseTo(-0.5, 4)
  })

  it('leaves even project sizes untouched (no re-base)', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16)
    expect(rootTranslation(glbJson(glb))).toEqual([0, 0, 0])
  })

  it('keeps the bottom anchor grounded while centring the other axes for odd sizes', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 9, undefined, { anchor: 'bottom' })
    const t = rootTranslation(glbJson(glb))
    expect(t[0]).toBeCloseTo(-0.5, 4)
    expect(t[1]).toBeCloseTo(0, 4) // raw min.y (0) grounded to 0
    expect(t[2]).toBeCloseTo(-0.5, 4)
  })

  it('alignToObjectBounds is shift-free (AABB-centring is already correct for odd sizes)', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 9, undefined, { alignToObjectBounds: true })
    const t = rootTranslation(glbJson(glb))
    // Raw AABB centre is +0.5, so AABB-centring alone lands the voxel on [-0.5,0.5) — no extra shift.
    expect(t[0]).toBeCloseTo(-0.5, 4)
    expect(t[1]).toBeCloseTo(-0.5, 4)
    expect(t[2]).toBeCloseTo(-0.5, 4)
  })
})

/** A pillar voxel plus one painted texel, so the export takes the textured overlay path. */
function texturedPillar(): { model: VoxelModel; texture: TextureModel } {
  const texture = emptyTextureModel(16)
  texture.faces.px[0] = 0
  return { model: pillarVoxel(), texture }
}

/** Map-free export carries no images/textures/samplers, no per-material map refs, and no
 * TEXCOORD attributes — solid-colour materials + bare geometry only. */
function expectMapFree(json: GlbJson) {
  expect(json.images).toBeUndefined()
  expect(json.textures).toBeUndefined()
  expect(json.samplers).toBeUndefined()
  expect(json.materials!.length).toBeGreaterThan(0)
  for (const m of json.materials!) {
    expect(m.baseColorTexture).toBeUndefined()
    expect(m.metallicRoughnessTexture).toBeUndefined()
    expect(m.occlusionTexture).toBeUndefined()
    expect(m.emissiveTexture).toBeUndefined()
    expect(m.normalTexture).toBeUndefined()
    // Solid colour still present (no fallback to white).
    expect(m.pbrMetallicRoughness?.baseColorFactor).toBeDefined()
  }
  const attrSets = json.meshes!.flatMap((mesh) => mesh.primitives.map((p) => Object.keys(p.attributes)))
  expect(attrSets.length).toBeGreaterThan(0)
  for (const keys of attrSets) {
    expect(keys).toContain('POSITION')
    expect(keys.some((k) => k.startsWith('TEXCOORD'))).toBe(false)
  }
}

describe('exportModelToGlb includeTextureMaps', () => {  it('textured export without maps is map-free but keeps solid colours', async () => {
    const { model, texture } = texturedPillar()
    const glb = await exportModelToGlb(model, DEFAULT_PALETTE, 16, texture, { includeTextureMaps: false })
    expectMapFree(glbJson(glb))
  })

  it('untextured export without maps is likewise map-free', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false })
    expectMapFree(glbJson(glb))
  })
})

describe('exportModelToGlb markers', () => {
  const markers = [
    { id: 'aaaaaaaa-0001', color: 1, position: [0, 0, 0] as [number, number, number], planeAxis: 'x' as const, planeOrientation: -1 as const },
    { id: 'bbbbbbbb-0002', color: 3, position: [2, 1, -1] as [number, number, number], planeAxis: 'y' as const, planeOrientation: 1 as const },
  ]

  it('exports markers as empty nodes with extras payloads at cell centers', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, { markers, includeTextureMaps: false })
    const json = glbJson(glb)
    const found = (json.nodes ?? []).filter((n) => n.extras?.voxpaint?.kind === 'marker')
    expect(found).toHaveLength(2)
    const tree = found.find((n) => n.extras?.voxpaint?.id === 'aaaaaaaa-0001')!
    expect(tree.extras?.voxpaint?.color).toBe(MARKER_COLORS[1])
    expect(tree.extras?.voxpaint?.axis).toBe('x')
    expect(tree.extras?.voxpaint?.orientation).toBe(-1)
    expect(tree.name).toContain(MARKER_COLORS[1].replace('#', ''))
    expect(tree.name).toContain('west')
    // Cell [0,0,0] centers at +0.5; even extent applies no re-base. The exporter may emit
    // the transform as TRS `translation` or a column-major `matrix` — read either.
    const t = tree.translation ?? (tree.matrix ? [tree.matrix[12], tree.matrix[13], tree.matrix[14]] : undefined)
    expect(t?.map((v) => Math.round(v * 100) / 100)).toEqual([0.5, 0.5, 0.5])
    // The west-facing marker's local +Z must point along its outward normal (-X). Read it
    // from TRS `rotation` (quaternion-rotated +Z) or from a column-major `matrix` (third
    // column), whichever the exporter emitted.
    const plusZ = tree.rotation
      ? quatRotateZ(tree.rotation)
      : tree.matrix ? [tree.matrix[8], tree.matrix[9], tree.matrix[10]] : undefined
    expect(plusZ?.map((v) => Math.round(v * 100) / 100)).toEqual([-1, 0, 0])
    // Marker nodes carry no mesh (empty locators).
    expect(json.meshes?.length ?? 0).toBeGreaterThan(0)
  })

  it('omits markers when includeMarkers is false', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, { markers, includeMarkers: false, includeTextureMaps: false })
    const found = (glbJson(glb).nodes ?? []).filter((n) => n.extras?.voxpaint?.kind === 'marker')
    expect(found).toEqual([])
  })

  it('keeps anchors voxel-pure when a marker sits far outside the model', async () => {
    const far = [...markers, { id: 'cccccccc-0003', color: 0, position: [7, 7, 7] as [number, number, number], planeAxis: 'y' as const, planeOrientation: 1 as const }]
    const withMarkers = glbJson(
      await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, { markers: far, anchor: 'bottom', includeTextureMaps: false }),
    )
    const without = glbJson(
      await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, { anchor: 'bottom', includeTextureMaps: false }),
    )
    expect(rootTranslation(withMarkers)).toEqual(rootTranslation(without))
  })
})

/** Total POSITION vertices across every exported mesh primitive. */
function positionVertexCount(json: GlbJson): number {
  let total = 0
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      total += json.accessors?.[prim.attributes.POSITION]?.count ?? 0
    }
  }
  return total
}

describe('exportModelToGlb textured mesh optimization', () => {  it('merges coplanar textured faces by default; optimizeMesh:false keeps per-voxel triangulation', async () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    const texture = emptyTextureModel(16)
    texture.faces.px[0] = 0
    // Map-free so no canvas APIs run in node — geometry still takes the textured path.
    const merged = positionVertexCount(
      glbJson(await exportModelToGlb(withBounds, DEFAULT_PALETTE, 16, texture, { includeTextureMaps: false })),
    )
    const raw = positionVertexCount(
      glbJson(
        await exportModelToGlb(withBounds, DEFAULT_PALETTE, 16, texture, { includeTextureMaps: false, optimizeMesh: false }),
      ),
    )
    expect(merged).toBeGreaterThan(0)
    expect(merged).toBeLessThan(raw)
  })
})

describe('exportModelToGlb cullInteriorFaces', () => {
  /** Two adjacent cubes in different colours — the interface is cross-group and culled by default. */
  function barModel(): VoxelModel {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: { kind: 'base', index: 1 } })
    return { ...model, bounds: recomputeBounds(model) }
  }

  it('keeps the cross-group interface when false (PBR path), culling by default', async () => {
    const culled = positionVertexCount(glbJson(await exportModelToGlb(barModel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false })))
    const kept = positionVertexCount(
      glbJson(await exportModelToGlb(barModel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false, cullInteriorFaces: false })),
    )
    // Two full boxes, unmerged across groups: 2 × 12 tris × 3 verts.
    expect(kept).toBe(72)
    expect(culled).toBeLessThan(kept)
  })

  it('keeps every voxel shell when false (textured path)', async () => {
    const texture = emptyTextureModel(16)
    texture.faces.px[0] = 0
    const culled = positionVertexCount(
      glbJson(await exportModelToGlb(barModel(), DEFAULT_PALETTE, 16, texture, { includeTextureMaps: false })),
    )
    const kept = positionVertexCount(
      glbJson(
        await exportModelToGlb(barModel(), DEFAULT_PALETTE, 16, texture, { includeTextureMaps: false, cullInteriorFaces: false }),
      ),
    )
    // 2 cubes × 12 shell tris × 3 verts, unmerged.
    expect(kept).toBe(72)
    expect(culled).toBeLessThan(kept)
  })
})

/** Material names carrying an occlusionTexture in the exported JSON. */
function materialsWithOcclusion(json: GlbJson): string[] {
  return (json.materials ?? []).filter((m) => m.occlusionTexture !== undefined).map((m) => m.name ?? '')
}

describe('exportModelToGlb noise without AO', () => {
  it('still emits the noise-carrying occlusionTexture when ambientOcclusion is off but noiseLevel > 0', async () => {
    const json = glbJson(
      await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, {
        includeTextureMaps: true,
        ambientOcclusion: false,
        noiseLevel: 0.5,
      }),
    )
    // The grain lives inside the AO atlas: dropping the map would drop the noise the preview
    // shows, so it must export even with AO off (matching usePreviewAOMaps).
    expect(materialsWithOcclusion(json).length).toBeGreaterThan(0)
  })

  it('omits occlusionTexture when both ambientOcclusion is off and noiseLevel is 0', async () => {
    const json = glbJson(
      await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, {
        includeTextureMaps: true,
        ambientOcclusion: false,
        noiseLevel: 0,
      }),
    )
    expect(materialsWithOcclusion(json)).toEqual([])
  })
})

describe('exportModelToGlb AO map exclusion', () => {
  it('emits occlusionTexture with ambientOcclusion on and omits it when off (maps otherwise intact)', async () => {
    const withAO = glbJson(
      await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: true, ambientOcclusion: true }),
    )
    expect(withAO.materials!.length).toBeGreaterThan(0)
    expect(materialsWithOcclusion(withAO).length).toBeGreaterThan(0)

    const withoutAO = glbJson(
      await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: true, ambientOcclusion: false }),
    )
    expect(materialsWithOcclusion(withoutAO)).toEqual([])
    // Same materials otherwise — only the AO map is gone.
    expect(withoutAO.materials!.length).toBe(withAO.materials!.length)
  })
})

describe('exportModelToGlb rig boxes', () => {
  /** Two voxels in different base slots (separate color groups): limb at x=0, hand at x=2. */
  function limbModel(): VoxelModel {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.color.set(encodeKey(2, 0, 0), { paletteSlot: { kind: 'base', index: 1 } })
    return { ...model, bounds: recomputeBounds(model) }
  }

  const rigBoxes = [
    { id: 'torso-id', name: 'torso', min: [-1, -1, -1] as [number, number, number], max: [3, 1, 1] as [number, number, number], parentId: null, pivot: null },
    { id: 'arm-id', name: 'arm', min: [2, 0, 0] as [number, number, number], max: [2, 0, 0] as [number, number, number], parentId: 'torso-id', pivot: null },
  ]

  type NamedNode = { name?: string; children?: number[]; mesh?: number; translation?: number[]; matrix?: number[] }
  const namedNodes = (json: GlbJson) => (json.nodes ?? []) as NamedNode[]
  const indexOf = (nodes: NamedNode[], name: string) => {
    const i = nodes.findIndex((n) => n.name === name)
    expect(i).toBeGreaterThanOrEqual(0)
    return i
  }
  // The exporter bakes node TRS as `matrix` (trs:false, like the existing slice nodes) —
  // read the translation from either encoding.
  const translationOf = (nodes: NamedNode[], name: string) => {
    const node = nodes.find((n) => n.name === name)
    expect(node).toBeDefined()
    if (node!.translation) return node!.translation
    if (node!.matrix) return [node!.matrix[12], node!.matrix[13], node!.matrix[14]]
    return [0, 0, 0]
  }

  it('nests rig groups and assigns the overlapping voxel to the deepest box', async () => {
    const json = glbJson(
      await exportModelToGlb(limbModel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false, rigBoxes }),
    )
    const nodes = namedNodes(json)
    const torso = indexOf(nodes, 'torso')
    const arm = indexOf(nodes, 'arm')
    // The arm group nests under the torso group (not directly under the root).
    expect(nodes[torso].children).toContain(arm)
    // Mesh nodes carry their owning box as a prefix: the x=2 voxel's mesh parents under arm,
    // the x=0 voxel's under torso (deepest-box-wins despite torso listing first).
    const armMesh = nodes.findIndex((n) => n.name?.startsWith('arm_') && n.mesh !== undefined)
    const torsoMesh = nodes.findIndex((n) => n.name?.startsWith('torso_') && n.mesh !== undefined)
    expect(armMesh).toBeGreaterThanOrEqual(0)
    expect(torsoMesh).toBeGreaterThanOrEqual(0)
    expect(nodes[arm].children).toContain(armMesh)
    expect(nodes[torso].children).toContain(torsoMesh)
  })

  it('exports the same voxels flat when boxes have no parents', async () => {
    // Disjoint bounds here (unlike the nesting test): with no hierarchy both boxes must own
    // exactly their own voxel and mount as siblings under the Rig container at the root.
    const flat = glbJson(
      await exportModelToGlb(limbModel(), DEFAULT_PALETTE, 16, undefined, {
        includeTextureMaps: false,
        rigBoxes: [
          { id: 'torso-id', name: 'torso', min: [-1, -1, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number], parentId: null, pivot: null },
          { id: 'arm-id', name: 'arm', min: [2, -1, -1] as [number, number, number], max: [3, 1, 1] as [number, number, number], parentId: null, pivot: null },
        ],
      }),
    )
    const nodes = namedNodes(flat)
    const torso = indexOf(nodes, 'torso')
    const arm = indexOf(nodes, 'arm')
    // Siblings: neither parents the other.
    expect(nodes[torso].children ?? []).not.toContain(arm)
    expect(nodes[arm].children ?? []).not.toContain(torso)
  })

  it('emits joint translations with mesh negation (poseable rest pose)', async () => {
    const joints = [
      { id: 'torso-id', name: 'torso', min: [-1, -1, -1] as [number, number, number], max: [3, 1, 1] as [number, number, number], parentId: null, pivot: [0, 1, 0] as [number, number, number] },
      { id: 'arm-id', name: 'arm', min: [2, 0, 0] as [number, number, number], max: [2, 0, 0] as [number, number, number], parentId: 'torso-id', pivot: [2, 0, 0] as [number, number, number] },
    ]
    const json = glbJson(
      await exportModelToGlb(limbModel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false, rigBoxes: joints }),
    )
    const nodes = namedNodes(json)
    // Joints sit at their pivots; the nested arm is relative to its parent.
    expect(translationOf(nodes, 'torso')).toEqual([0, 1, 0])
    expect(translationOf(nodes, 'arm')).toEqual([2, -1, 0])
    // Meshes hang under their joint recentered by -pivot, so the rest pose is unchanged and
    // rotating the joint orbits the part around the authored center.
    const armMesh = nodes.find((n) => n.name?.startsWith('arm_') && n.mesh !== undefined)
    const torsoMesh = nodes.find((n) => n.name?.startsWith('torso_') && n.mesh !== undefined)
    const meshTranslation = (n: NamedNode | undefined) =>
      n?.translation ?? (n?.matrix ? [n.matrix[12], n.matrix[13], n.matrix[14]] : [0, 0, 0])
    expect(meshTranslation(armMesh)).toEqual([-2, 0, 0])
    expect(meshTranslation(torsoMesh)).toEqual([0, -1, 0])
  })

  it('excludes rigged voxels from slice nodes (rig wins)', async () => {
    const animSettings = new Map([
      [encodeSliceKey('z', 0), { ...defaultAnimationSettings(), animationType: 'rotate-cw' as const }],
    ])
    // Only the hand voxel is rigged: the limb voxel keeps animating, the hand goes rigid.
    const json = glbJson(
      await exportModelToGlb(limbModel(), DEFAULT_PALETTE, 16, undefined, {
        includeTextureMaps: false,
        rigBoxes: [
          { id: 'arm-id', name: 'arm', min: [2, 0, 0] as [number, number, number], max: [2, 0, 0] as [number, number, number], parentId: null, pivot: null },
        ],
      }, animSettings),
    )
    const nodes = namedNodes(json)
    // The animated slice node exists and owns only the unrigged voxel's default-named mesh.
    const animNode = nodes.find((n) => n.name?.startsWith('anim_'))
    expect(animNode).toBeDefined()
    const animChildren = (animNode!.children ?? []).map((i) => nodes[i].name ?? '')
    expect(animChildren.some((n) => n.startsWith('voxel_'))).toBe(true)
    expect(animChildren.some((n) => n.startsWith('arm_'))).toBe(false)
    // The rigged voxel's mesh parents under the arm joint, mounted at the Rig container.
    const arm = indexOf(nodes, 'arm')
    expect(nodes[arm].children ?? []).not.toEqual([])
    const rig = indexOf(nodes, 'Rig')
    expect(nodes[rig].children).toContain(arm)
  })

  it('exports loop clips on looped joints (and none for static joints)', async () => {
    const boxes = [
      { id: 'torso-id', name: 'torso', min: [-1, -1, -1] as [number, number, number], max: [3, 1, 1] as [number, number, number], parentId: null, pivot: null, loop: { kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4 } as const },
      { id: 'arm-id', name: 'arm', min: [2, 0, 0] as [number, number, number], max: [2, 0, 0] as [number, number, number], parentId: 'torso-id', pivot: null, loop: { kind: 'slide', axis: 'x', direction: -1, speed: 2, amount: 3 } as const },
    ]
    const json = glbJson(
      await exportModelToGlb(limbModel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false, rigBoxes: boxes }),
    )
    const nodes = namedNodes(json)
    const torso = indexOf(nodes, 'torso')
    const clips = json.animations ?? []
    expect(clips).toHaveLength(2)
    // Rotate drives the joint quaternion (linear full-turn loop)…
    const spin = clips.find((c) => c.name === 'anim_torso')
    expect(spin).toBeDefined()
    expect(spin!.channels?.[0].target?.node).toBe(torso)
    expect(spin!.channels?.[0].target?.path).toBe('rotation')
    expect(spin!.samplers?.[0].interpolation).toBe('LINEAR')
    // …slide drives position with a CUBICSPLINE sine around the rest pose.
    const arm = indexOf(nodes, 'arm')
    const shuttle = clips.find((c) => c.name === 'anim_arm')
    expect(shuttle).toBeDefined()
    expect(shuttle!.channels?.[0].target?.node).toBe(arm)
    expect(shuttle!.channels?.[0].target?.path).toBe('translation')
    expect(shuttle!.samplers?.[0].interpolation).toBe('CUBICSPLINE')
    // Static rigs export no clips at all.
    const still = glbJson(
      await exportModelToGlb(limbModel(), DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false, rigBoxes }),
    )
    expect(still.animations ?? []).toEqual([])
  })

  it('keeps cross-rig interfaces with default culling (PBR)', async () => {
    // Two adjacent same-slot voxels, one box each: no welding across boxes, no culled seam —
    // two whole cubes (2 × 12 tris × 3 verts).
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    const split = [
      { id: 'a', name: 'a', min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number], parentId: null, pivot: null },
      { id: 'b', name: 'b', min: [1, 0, 0] as [number, number, number], max: [1, 0, 0] as [number, number, number], parentId: null, pivot: null },
    ]
    const rigged = positionVertexCount(
      glbJson(await exportModelToGlb(withBounds, DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false, rigBoxes: split })),
    )
    expect(rigged).toBe(72)
    // Control: no boxes welds the pair into one box (12 tris).
    const merged = positionVertexCount(
      glbJson(await exportModelToGlb(withBounds, DEFAULT_PALETTE, 16, undefined, { includeTextureMaps: false })),
    )
    expect(merged).toBe(36)
  })

  it('keeps cross-rig interfaces on the textured path', async () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
    const withBounds = { ...model, bounds: recomputeBounds(model) }
    const texture = emptyTextureModel(16)
    texture.faces.px[0] = 0
    const split = [
      { id: 'a', name: 'a', min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number], parentId: null, pivot: null },
      { id: 'b', name: 'b', min: [1, 0, 0] as [number, number, number], max: [1, 0, 0] as [number, number, number], parentId: null, pivot: null },
    ]
    const rigged = positionVertexCount(
      glbJson(await exportModelToGlb(withBounds, DEFAULT_PALETTE, 16, texture, { includeTextureMaps: false, rigBoxes: split })),
    )
    expect(rigged).toBe(72)
  })

  it('emits joints for empty boxes so the skeleton mirrors the outline', async () => {    const json = glbJson(
      await exportModelToGlb(limbModel(), DEFAULT_PALETTE, 16, undefined, {
        includeTextureMaps: false,
        rigBoxes: [
          ...rigBoxes,
          { id: 'ghost-id', name: 'ghost', min: [5, 5, 5] as [number, number, number], max: [6, 6, 6] as [number, number, number], parentId: null, pivot: null },
        ],
      }),
    )
    const nodes = namedNodes(json)
    expect(nodes.some((n) => n.name === 'ghost')).toBe(true)
  })
})

