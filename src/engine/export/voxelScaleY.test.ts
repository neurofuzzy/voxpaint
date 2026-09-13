import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { encodeSliceKey } from '@/engine/animation/animationLayers'
import { exportModelToGlb, type GltfExportOptions } from './gltfExport'
import { exportModelToStl, type StlExportOptions } from './stlExport'

// three's GLTFExporter assembles the binary .glb via Blob + FileReader — browser APIs absent in
// the node test environment. Minimal FileReader supporting only the ArrayBuffer path the binary
// export uses (these tests export no textures, so the image/data-URL paths never run).
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

/** A single unit voxel at the grid origin: world [0,1]³ on the default (center/no-op) anchor. */
function pillarVoxel(): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
  return { ...model, bounds: recomputeBounds(model) }
}

interface GlbJson {
  nodes?: Array<{ name?: string; translation?: [number, number, number]; matrix?: number[] }>
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>
  accessors?: Array<{ min?: number[]; max?: number[] }>
}

/** Parse the JSON chunk out of a binary .glb buffer. */
function glbJson(buffer: ArrayBuffer): GlbJson {
  const view = new DataView(buffer)
  expect(view.getUint32(0, true)).toBe(0x46546c67) // 'glTF' magic
  const jsonLength = view.getUint32(12, true)
  const jsonBytes = new Uint8Array(buffer, 20, jsonLength)
  return JSON.parse(new TextDecoder().decode(jsonBytes)) as GlbJson
}

/** World-space Y range of the first mesh's POSITION accessor. */
function positionYRange(buffer: ArrayBuffer): [number, number] {
  const json = glbJson(buffer)
  const prim = json.meshes!.flatMap((m) => m.primitives)[0]
  const acc = json.accessors![prim.attributes.POSITION]
  return [acc.min![1], acc.max![1]]
}

function nodeTranslation(json: GlbJson, prefix: string): [number, number, number] {
  const node = json.nodes?.find((n) => n.name?.startsWith(prefix))
  expect(node).toBeDefined()
  if (node!.translation) return node!.translation
  if (node!.matrix) return [node!.matrix[12], node!.matrix[13], node!.matrix[14]]
  return [0, 0, 0]
}

/** World-space Y range of every vertex in a binary STL buffer. */
function stlYRange(buffer: ArrayBuffer): [number, number] {
  const view = new DataView(buffer)
  const count = view.getUint32(80, true)
  let minY = Infinity
  let maxY = -Infinity
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12 // skip normal (12 bytes), read 3 vertices
    for (let v = 0; v < 3; v++) {
      const y = view.getFloat32(base + v * 12 + 4, true)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return [minY, maxY]
}

describe('GLTF export bakes voxelScaleY into vertices (WYSIWYG)', () => {
  it('1x exports the unit voxel unchanged ([0,1] on every axis)', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16)
    expect(positionYRange(glb)).toEqual([0, 1])
  })

  it('0.5x halves world Y ([0,0.5])', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, {
      voxelScaleY: 0.5,
    } as GltfExportOptions)
    const [minY, maxY] = positionYRange(glb)
    expect(minY).toBeCloseTo(0, 4)
    expect(maxY).toBeCloseTo(0.5, 4)
  })

  it('2x doubles world Y ([0,2])', async () => {
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, {
      voxelScaleY: 2,
    } as GltfExportOptions)
    const [minY, maxY] = positionYRange(glb)
    expect(minY).toBeCloseTo(0, 4)
    expect(maxY).toBeCloseTo(2, 4)
  })

  it('animated slice nodes agree with scaled vertices (no vertex/node mismatch)', async () => {
    const settings: SliceAnimSettings = { animationType: 'slide-horizontal', speed: 1, slideAmount: 4, swingAmount: 30 }
    const animSettings = new Map<SliceKey, SliceAnimSettings>([[encodeSliceKey('z', 0), settings]])
    const glb = await exportModelToGlb(pillarVoxel(), DEFAULT_PALETTE, 16, undefined, {
      voxelScaleY: 0.5,
    } as GltfExportOptions, animSettings)
    const json = glbJson(glb)
    const [, nodeY] = nodeTranslation(json, 'anim_')
    const [minY, maxY] = positionYRange(glb)
    // The slice node sits at the voxel's scaled center, matching the scaled vertices.
    expect(nodeY).toBeCloseTo((minY + maxY) / 2, 4)
  })
})

describe('STL export bakes voxelScaleY (default bottom anchor grounds at Y=0)', () => {
  it('1x exports Y in [0,1]', () => {
    expect(stlYRange(exportModelToStl(pillarVoxel(), DEFAULT_PALETTE))).toEqual([0, 1])
  })

  it('0.5x exports Y in [0,0.5]', () => {
    const [minY, maxY] = stlYRange(exportModelToStl(pillarVoxel(), DEFAULT_PALETTE, { voxelScaleY: 0.5 } as StlExportOptions))
    expect(minY).toBeCloseTo(0, 4)
    expect(maxY).toBeCloseTo(0.5, 4)
  })

  it('2x exports Y in [0,2]', () => {
    const [minY, maxY] = stlYRange(exportModelToStl(pillarVoxel(), DEFAULT_PALETTE, { voxelScaleY: 2 } as StlExportOptions))
    expect(minY).toBeCloseTo(0, 4)
    expect(maxY).toBeCloseTo(2, 4)
  })
})
