import { decodeKey, emptyModel, encodeKey, recomputeBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { CellKey, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { Marker, SerializedMarkerPosition } from '@/engine/markers/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteState } from '@/engine/palette/types'
import type { BoxFace, TextureModel } from '@/engine/texture/types'
import { BOX_FACES, faceSizeFor, TEXEL_SCALE } from '@/engine/texture/types'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { encodeSliceKey } from '@/engine/animation/animationLayers'
import { CURRENT_SCHEMA_VERSION, type ProjectMeta, type SerializedAnimLayer, type SerializedSliceMask, type SerializedSlicePivot, type SerializedTexture, type ViewSettings, type VoxPaintProjectFile } from './schema'

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

function serializeTexture(texture: TextureModel, gridExtent: GridExtent): SerializedTexture {
  const faces = {} as Record<BoxFace, string>
  for (const face of BOX_FACES) faces[face] = u8ToBase64(texture.faces[face])
  return { texelScale: TEXEL_SCALE, faceSize: faceSizeFor(gridExtent), faces }
}

function deserializeTexture(s: SerializedTexture, gridExtent: GridExtent): TextureModel {
  // Guard against an incompatible face size (shouldn't happen — faceSize is derived from the
  // project's own locked-in gridExtent — but a hand-edited or corrupt file could still mismatch)
  // — rather than remap texels, fall back to an empty texture so the project still loads.
  if (s.faceSize !== faceSizeFor(gridExtent)) return emptyTextureModel(gridExtent)
  const texture = emptyTextureModel(gridExtent)
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
    layers.push({ axis, offset, animationType: settings.animationType, speed: settings.speed, slideAmount: settings.slideAmount, swingAmount: settings.swingAmount })
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
      swingAmount: layer.swingAmount ?? 30,
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

function serializeSlicePivots(slicePivots: Map<SliceKey, CellKey>): SerializedSlicePivot[] {
  const pivots: SerializedSlicePivot[] = []
  for (const [key, cellKey] of slicePivots) {
    const [axis, offsetStr] = key.split(',')
    pivots.push({ axis: axis as any, offset: Number(offsetStr), cellKey })
  }
  return pivots
}

function deserializeSlicePivots(pivots: SerializedSlicePivot[]): Map<SliceKey, CellKey> {
  const map = new Map<SliceKey, CellKey>()
  for (const pivot of pivots) {
    map.set(encodeSliceKey(pivot.axis, pivot.offset), pivot.cellKey)
  }
  return map
}

function serializeMarkers(markers: Marker[]): SerializedMarkerPosition[] {
  return markers.map((m) => ({ id: m.id, label: m.label, x: m.position[0], y: m.position[1], z: m.position[2] }))
}

function deserializeMarkers(entries: SerializedMarkerPosition[] | undefined, gridExtent: GridExtent): Marker[] {
  if (!entries) return []
  const out: Marker[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    if (typeof e?.id !== 'string' || typeof e?.label !== 'string') continue
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y) || !Number.isInteger(e.z)) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    const position: [number, number, number] = [e.x, e.y, e.z]
    // Hand-edited or corrupt files could place markers outside the working cube — drop those
    // rather than refusing to load (same spirit as the texture faceSize guard above).
    if (!withinWorkingBounds(position, gridExtent)) continue
    out.push({ id: e.id, label: e.label.slice(0, 120), position })
  }
  return out
}

export function serializeProject(model: VoxelModel, palette: PaletteState, meta: ProjectMeta, texture: TextureModel, view?: ViewSettings, animSettings?: Map<SliceKey, SliceAnimSettings>, sliceMasks?: Map<SliceKey, Set<CellKey>>, slicePivots?: Map<SliceKey, CellKey>, markers?: Marker[]): VoxPaintProjectFile {
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
    texture: serializeTexture(texture, meta.gridExtent),
    view,
    animations: animSettings ? serializeAnimations(animSettings) : undefined,
    masks: sliceMasks ? serializeSliceMasks(sliceMasks) : undefined,
    pivots: slicePivots ? serializeSlicePivots(slicePivots) : undefined,
    markers: markers ? serializeMarkers(markers) : undefined,
  }
}

export function deserializeProject(file: VoxPaintProjectFile): { model: VoxelModel; palette: PaletteState; meta: ProjectMeta; texture: TextureModel; view: ViewSettings; animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>>; slicePivots: Map<SliceKey, CellKey>; markers: Marker[] } {
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
  const texture = file.texture ? deserializeTexture(file.texture, file.meta.gridExtent) : emptyTextureModel(file.meta.gridExtent)
  const view: ViewSettings = { ambientOcclusion: false, noiseLevel: 0, specularNoiseLevel: 0, aoStrength: 1, glassRoughnessLevel: 0.3, exposure: 1, exportScaleFactor: 100, exportAnchor: 'center', exportAlignToObjectBounds: false, exportDisableMeshOptimization: false, exportIncludeTextureMaps: true, exportIncludeAOMaps: true, exportIncludeMarkers: true, ...file.view }
  const animSettings = file.animations ? deserializeAnimations(file.animations) : new Map()
  const sliceMasks = file.masks ? deserializeSliceMasks(file.masks) : new Map()
  const slicePivots = file.pivots ? deserializeSlicePivots(file.pivots) : new Map()
  // `emissiveAnim` was added to PaletteState after this field was already required elsewhere in the
  // palette shape — older files simply don't have it, so default-merge rather than bump the schema
  // (same treatment `exportAlignToObjectBounds` got for `view`).
  const palette: PaletteState = { ...DEFAULT_PALETTE, ...file.palette }
  // `noiseSeed` likewise post-dates `ProjectMeta` being otherwise fully required. Default to 0 (the
  // hash functions' unseeded behavior) rather than a fresh random seed, so an old project's noise
  // looks exactly the same as it always did instead of visibly shifting on next load.
  // `voxelScaleY` is the same story one generation later: pre-scale files load as 1x (unit cubes).
  const meta: ProjectMeta = { ...file.meta, noiseSeed: file.meta.noiseSeed ?? 0, voxelScaleY: file.meta.voxelScaleY ?? 1 }
  const markers = deserializeMarkers(file.markers, meta.gridExtent)
  return { model: { ...built, bounds: recomputeBounds(built) }, palette, meta, texture, view, animSettings, sliceMasks, slicePivots, markers }
}
