import { decodeKey, emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import type { BoxFace, TextureModel } from '@/engine/texture/types'
import { BOX_FACES, FACE_SIZE, TEXEL_SCALE } from '@/engine/texture/types'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
import { CURRENT_SCHEMA_VERSION, type ProjectMeta, type SerializedTexture, type ViewSettings, type VoxPaintProjectFile } from './schema'

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

export function serializeProject(model: VoxelModel, palette: PaletteState, meta: ProjectMeta, texture: TextureModel, view?: ViewSettings): VoxPaintProjectFile {
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
  }
}

export function deserializeProject(file: VoxPaintProjectFile): { model: VoxelModel; palette: PaletteState; meta: ProjectMeta; texture: TextureModel; view: ViewSettings } {
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
  const view: ViewSettings = { ambientOcclusion: false, noiseLevel: 0, specularNoiseLevel: 0, aoStrength: 1, glassRoughnessLevel: 0.3, exportScaleFactor: 100, exportAnchor: 'center', ...file.view }
  return { model: { ...built, bounds: recomputeBounds(built) }, palette: file.palette, meta: file.meta, texture, view }
}
