import { decodeKey, emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { CellKey, VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { BoxFace, TextureModel } from '@/engine/texture/types'
import { BOX_FACES, FACE_SIZE, TEXEL_SCALE } from '@/engine/texture/types'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { encodeSliceKey } from '@/engine/animation/animationLayers'
import { CURRENT_SCHEMA_VERSION, type ProjectMeta, type SerializedAnimLayer, type SerializedSliceMask, type SerializedTexture, type ViewSettings, type VoxPaintProjectFile } from './schema'

function u8ToBase64(a: Uint8Array): string {
  let s = ''
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i])
  return btoa(s)
}

function base64ToU8(b64: string): Uint8Array {
  const s = atob(b64)
  const a = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i)
  return a
}

function serializeTexture(texture: TextureModel): SerializedTexture {
  const faces = {} as Record<BoxFace, string>
  for (const face of BOX_FACES) faces[face] = u8ToBase64(texture.faces[face])
  return { texelScale: TEXEL_SCALE, faceSize: FACE_SIZE, faces }
}

function deserializeTexture(s: SerializedTexture): TextureModel {
  // Guard against an incompatible face size (e.g. a future project grid-size change) — rather than
  // remap texels, fall back to an empty texture so the project still loads.
  if (s.faceSize !== FACE_SIZE) return emptyTextureModel()
  const texture = emptyTextureModel()
  for (const face of BOX_FACES) {
    const arr = base64ToU8(s.faces[face] ?? '')
    if (arr.length === texture.faces[face].length) texture.faces[face] = arr
  }
  return texture
}

function serializeAnimations(animSettings: Map<SliceKey, SliceAnimSettings>): SerializedAnimLayer[] {
  const layers: SerializedAnimLayer[] = []
  for (const [key, settings] of animSettings) {
    const { axis, offset } = (() => { const [a, o] = key.split(','); return { axis: a as any, offset: Number(o) } })()
    layers.push({ axis, offset, animationType: settings.animationType, speed: settings.speed, slideAmount: settings.slideAmount })
  }
  return layers
}

function deserializeAnimations(layers: SerializedAnimLayer[]): Map<SliceKey, SliceAnimSettings> {
  const map = new Map<SliceKey, SliceAnimSettings>()
  for (const layer of layers) {
    map.set(encodeSliceKey(layer.axis, layer.offset), {
      animationType: layer.animationType,
      speed: layer.speed,
      slideAmount: layer.slideAmount,
    })
  }
  return map
}

function serializeSliceMasks(sliceMasks: Map<SliceKey, Set<CellKey>>): SerializedSliceMask[] {
  const layers: SerializedSliceMask[] = []
  for (const [key, mask] of sliceMasks) {
    const [axis, offsetStr] = key.split(',')
    layers.push({ axis: axis as any, offset: Number(offsetStr), cellKeys: Array.from(mask) })
  }
  return layers
}

function deserializeSliceMasks(layers: SerializedSliceMask[]): Map<SliceKey, Set<CellKey>> {
  const map = new Map<SliceKey, Set<CellKey>>()
  for (const layer of layers) {
    map.set(encodeSliceKey(layer.axis, layer.offset), new Set(layer.cellKeys))
  }
  return map
}

export function serializeProject(model: VoxelModel, palette: PaletteState, meta: ProjectMeta, texture: TextureModel, view?: ViewSettings, animSettings?: Map<SliceKey, SliceAnimSettings>, sliceMasks?: Map<SliceKey, Set<CellKey>>): VoxPaintProjectFile {
  const colorCells = Array.from(model.color.entries()).map(([key, cell]) => {
    const [x, y, z] = decodeKey(key)
    return { x, y, z, paletteSlot: cell.paletteSlot }
  })
  const chamferCells = Array.from(model.chamfer.entries()).map(([key, cell]) => {
    const [x, y, z] = decodeKey(key)
    return { x, y, z, ...cell }
  })
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta,
    palette,
    model: { bounds: model.bounds, colorCells, chamferCells },
    texture: serializeTexture(texture),
    view,
    animations: animSettings ? serializeAnimations(animSettings) : undefined,
    masks: sliceMasks ? serializeSliceMasks(sliceMasks) : undefined,
  }
}

export function deserializeProject(file: VoxPaintProjectFile): { model: VoxelModel; palette: PaletteState; meta: ProjectMeta; texture: TextureModel; view: ViewSettings; animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>> } {
  const model = emptyModel()
  const color = new Map(model.color)
  const chamfer = new Map(model.chamfer)

  for (const cell of file.model.colorCells) {
    color.set(encodeKey(cell.x, cell.y, cell.z), { paletteSlot: cell.paletteSlot })
  }
  for (const cell of file.model.chamferCells) {
    chamfer.set(encodeKey(cell.x, cell.y, cell.z), {
      planeAxis: cell.planeAxis,
      planeOrientation: cell.planeOrientation,
      resolvedTo: cell.resolvedTo,
    })
  }

  const built: VoxelModel = { color, chamfer, bounds: file.model.bounds }
  const texture = file.texture ? deserializeTexture(file.texture) : emptyTextureModel()
  const view: ViewSettings = { ambientOcclusion: false, noiseLevel: 0, specularNoiseLevel: 0, aoStrength: 1, glassRoughnessLevel: 0.3, exposure: 1, exportScaleFactor: 100, exportAnchor: 'center', ...file.view }
  const animSettings = file.animations ? deserializeAnimations(file.animations) : new Map()
  const sliceMasks = file.masks ? deserializeSliceMasks(file.masks) : new Map()
  return { model: { ...built, bounds: recomputeBounds(built) }, palette: file.palette, meta: file.meta, texture, view, animSettings, sliceMasks }
}
