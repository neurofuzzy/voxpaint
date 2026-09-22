import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { TextureModel } from '@/engine/texture/types'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
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
  nodes?: Array<{ name?: string; translation?: [number, number, number]; matrix?: number[] }>
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

/** Material names carrying an occlusionTexture in the exported JSON. */
function materialsWithOcclusion(json: GlbJson): string[] {
  return (json.materials ?? []).filter((m) => m.occlusionTexture !== undefined).map((m) => m.name ?? '')
}

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
