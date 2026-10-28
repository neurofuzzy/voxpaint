import { decodeKey, effectiveExtent, emptyModel, encodeKey, recomputeBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import type { CellKey, GridExtent, VoxelModel } from '@/engine/grid/types'
import type { Marker, SerializedMarkerPosition } from '@/engine/markers/types'
import type { Pose, PoseCycle, RigBox, RigTween } from '@/engine/rigging/types'
import { newTweenId } from '@/engine/rigging/types'
import { sanitizePose, sanitizeRigTween } from '@/engine/rigging/types'
import { MARKER_COLORS } from '@/engine/markers/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteState } from '@/engine/palette/types'
import type { BoxFace, TextureModel } from '@/engine/texture/types'
import { BOX_FACES, faceSizeFor, TEXEL_SCALE } from '@/engine/texture/types'
import { emptyTextureModel, normalizeTexelScale } from '@/engine/texture/TextureStore'
import type { SliceAnimSettings, SliceKey } from '@/engine/animation/types'
import { encodeSliceKey } from '@/engine/animation/animationLayers'
import { CURRENT_SCHEMA_VERSION, type ProjectMeta, type SerializedAnimLayer, type SerializedPose, type SerializedPoseCycle, type SerializedRigBox, type SerializedSliceMask, type SerializedSlicePivot, type SerializedTexture, type ViewSettings, type VoxPaintProjectFile } from './schema'

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

function serializeTexture(texture: TextureModel, gridExtent: GridExtent, texelScale: number): SerializedTexture {
  const faces = {} as Record<BoxFace, string>
  for (const face of BOX_FACES) faces[face] = u8ToBase64(texture.faces[face])
  return { texelScale, faceSize: faceSizeFor(gridExtent, texelScale), faces }
}

function deserializeTexture(s: SerializedTexture, gridExtent: GridExtent, texelScale: number): TextureModel {
  // Guard against an incompatible face size (shouldn't happen — faceSize is derived from the
  // project's own locked-in gridExtent + texelScale — but a hand-edited or corrupt file could
  // still mismatch) — rather than remap texels, fall back to an empty texture so the project
  // still loads.
  if (s.faceSize !== faceSizeFor(gridExtent, texelScale)) return emptyTextureModel(gridExtent, texelScale)
  const texture = emptyTextureModel(gridExtent, texelScale)
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
  return markers.map((m) => ({
    id: m.id,
    color: m.color,
    x: m.position[0],
    y: m.position[1],
    z: m.position[2],
    planeAxis: m.planeAxis,
    planeOrientation: m.planeOrientation,
  }))
}

function serializePoses(poses: Pose[]): SerializedPose[] {
  return poses.map((p) => ({
    id: p.id,
    name: p.name,
    joints: Object.fromEntries(Object.entries(p.joints).map(([id, e]) => [id, [e[0], e[1], e[2]] as [number, number, number]])),
  }))
}

function deserializePoses(entries: SerializedPose[] | undefined, validBoxIds: Set<string>): Pose[] {
  if (!entries) return []
  const out: Pose[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    const pose = sanitizePose(e, validBoxIds)
    if (!pose || seen.has(pose.id)) continue
    seen.add(pose.id)
    out.push(pose)
  }
  return out
}

function serializePoseCycle(cycle: PoseCycle | null): SerializedPoseCycle | undefined {
  if (!cycle) return undefined
  return { fromId: cycle.fromId, toId: cycle.toId, mode: cycle.mode, speed: cycle.speed }
}

function deserializePoseCycle(raw: SerializedPoseCycle | undefined, poseIds: Set<string>): PoseCycle | null {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.fromId !== 'string' || typeof raw.toId !== 'string') return null
  if (!poseIds.has(raw.fromId) || !poseIds.has(raw.toId)) return null
  if (raw.mode !== 'once' && raw.mode !== 'loop' && raw.mode !== 'pingpong') return null
  if (raw.speed !== 1 && raw.speed !== 2 && raw.speed !== 3) return null
  return { fromId: raw.fromId, toId: raw.toId, mode: raw.mode, speed: raw.speed }
}

function serializeRigBoxes(rigBoxes: RigBox[]): SerializedRigBox[] {
  return rigBoxes.map((b) => ({
    id: b.id,
    name: b.name,
    min: [b.min[0], b.min[1], b.min[2]],
    max: [b.max[0], b.max[1], b.max[2]],
    parentId: b.parentId,
    ...(b.pivot ? { pivot: [b.pivot[0], b.pivot[1], b.pivot[2]] as [number, number, number] } : {}),
    ...((b.tweens ?? []).length > 0 ? { tweens: (b.tweens ?? []).map((t) => ({ ...t })) } : {}),
  }))
}

function deserializeRigBoxes(entries: SerializedRigBox[] | undefined, gridExtent: GridExtent): RigBox[] {
  if (!entries) return []
  const out: RigBox[] = []
  const seen = new Set<string>()
  const rawParents = new Map<string, string | null>()
  // Stale exact duplicates (same clamped bounds — creatable before footprint hit-testing
  // selected first, or by hand-editing): keep the first, fold the rest into it. Export
  // ties break by order anyway, so dropping twins is behavior-preserving.
  const seenBounds = new Map<string, string>()
  const dupeOf = new Map<string, string>()
  for (const e of entries) {
    if (typeof e?.id !== 'string' || typeof e?.name !== 'string') continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    const nums = [...(e.min ?? []), ...(e.max ?? [])]
    if (nums.length !== 6 || !nums.every((n) => Number.isInteger(n))) continue
    const [x0, y0, z0, x1, y1, z1] = nums
    // Clamp into working bounds; drop inverted/empty boxes (hand-edited or resized-away).
    const lo: [number, number, number] = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)]
    const hi: [number, number, number] = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)]
    if (!withinWorkingBounds(lo, gridExtent) && !withinWorkingBounds(hi, gridExtent)) continue
    const min: [number, number, number] = [
      Math.max(lo[0], -gridExtent / 2), Math.max(lo[1], -gridExtent / 2), Math.max(lo[2], -gridExtent / 2),
    ]
    const max: [number, number, number] = [
      Math.min(hi[0], gridExtent / 2 - 1), Math.min(hi[1], gridExtent / 2 - 1), Math.min(hi[2], gridExtent / 2 - 1),
    ]
    if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2]) continue
    const boundsKey = `${min[0]},${min[1]},${min[2]}|${max[0]},${max[1]},${max[2]}`
    const survivor = seenBounds.get(boundsKey)
    if (survivor !== undefined) {
      dupeOf.set(e.id, survivor)
      continue
    }
    seenBounds.set(boundsKey, e.id)
    // Pivot override: a grid point inside the working cube's gridlines (integers = cell
    // centers, half-integers = cell-boundary joint faces). It may sit outside the box itself.
    // Malformed entries fall back to the box center.
    let pivot: [number, number, number] | null = null
    const p = e.pivot
    if (Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n))) {
      const half = effectiveExtent(gridExtent) / 2
      if (p.every((n) => n >= -half && n <= half)) pivot = [p[0], p[1], p[2]]
    }
    // Tween stack (v15; v14 files carry a single `loop` — folded in by the migration).
    // Malformed entries are dropped; an id collision within the box falls back to a fresh id.
    const tweens: RigTween[] = []
    const seenTweenIds = new Set<string>()
    for (const raw of e.tweens ?? []) {
      const tween = sanitizeRigTween(raw)
      if (!tween) continue
      if (seenTweenIds.has(tween.id)) tween.id = newTweenId()
      seenTweenIds.add(tween.id)
      tweens.push(tween)
    }
    out.push({ id: e.id, name: e.name.slice(0, 64) || 'rig', min, max, parentId: null, pivot, tweens })
    rawParents.set(e.id, typeof e.parentId === 'string' ? e.parentId : null)
  }
  // Resolve parents second: keep the link only when the parent survived, isn't self, and the
  // chain terminates without a cycle (hand-edited files) — otherwise root the box. Parent ids
  // pointing at a collapsed duplicate follow it to the survivor (identical bounds, so the
  // nesting means exactly the same thing).
  const byId = new Map(out.map((b) => [b.id, b]))
  for (const box of out) {
    let parentId = rawParents.get(box.id) ?? null
    if (parentId && dupeOf.has(parentId)) parentId = dupeOf.get(parentId)!
    if (!parentId || parentId === box.id || !byId.has(parentId)) continue
    const seenChain = new Set<string>([box.id])
    let current: string | null = parentId
    let cyclic = false
    while (current) {
      if (seenChain.has(current)) { cyclic = true; break }
      seenChain.add(current)
      current = rawParents.get(current) ?? null
      if (current && !byId.has(current)) { current = null; break }
    }
    if (!cyclic) box.parentId = parentId
  }
  return out
}

function deserializeMarkers(entries: SerializedMarkerPosition[] | undefined, gridExtent: GridExtent): Marker[] {
  if (!entries) return []
  const out: Marker[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    if (typeof e?.id !== 'string') continue
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y) || !Number.isInteger(e.z)) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    const position: [number, number, number] = [e.x, e.y, e.z]
    // Hand-edited or corrupt files could place markers outside the working cube — drop those
    // rather than refusing to load (same spirit as the texture faceSize guard above).
    if (!withinWorkingBounds(position, gridExtent)) continue
    // Clamp out-of-range color indices to the default instead of dropping the marker.
    const color = Number.isInteger(e.color) && (e.color as number) >= 0 && (e.color as number) < MARKER_COLORS.length ? e.color : 1
    // Unknown facing falls back to up rather than dropping the marker.
    const planeAxis = e.planeAxis === 'x' || e.planeAxis === 'y' || e.planeAxis === 'z' ? e.planeAxis : 'y'
    const planeOrientation = e.planeOrientation === 1 || e.planeOrientation === -1 ? e.planeOrientation : 1
    out.push({ id: e.id, color, position, planeAxis, planeOrientation })
  }
  return out
}

export function serializeProject(model: VoxelModel, palette: PaletteState, meta: ProjectMeta, texture: TextureModel, view?: ViewSettings, animSettings?: Map<SliceKey, SliceAnimSettings>, sliceMasks?: Map<SliceKey, Set<CellKey>>, slicePivots?: Map<SliceKey, CellKey>, markers?: Marker[], rigBoxes?: RigBox[], poses?: Pose[], poseCycle?: PoseCycle | null): VoxPaintProjectFile {
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
    texture: serializeTexture(texture, meta.gridExtent, normalizeTexelScale(meta.texelScale ?? TEXEL_SCALE)),
    view,
    animations: animSettings ? serializeAnimations(animSettings) : undefined,
    masks: sliceMasks ? serializeSliceMasks(sliceMasks) : undefined,
    pivots: slicePivots ? serializeSlicePivots(slicePivots) : undefined,
    markers: markers ? serializeMarkers(markers) : undefined,
    rigBoxes: rigBoxes ? serializeRigBoxes(rigBoxes) : undefined,
    ...(poses && poses.length > 0 ? { poses: serializePoses(poses) } : {}),
    ...(poseCycle ? { poseCycle: serializePoseCycle(poseCycle) } : {}),
  }
}

export function deserializeProject(file: VoxPaintProjectFile): { model: VoxelModel; palette: PaletteState; meta: ProjectMeta; texture: TextureModel; view: ViewSettings; animSettings: Map<SliceKey, SliceAnimSettings>; sliceMasks: Map<SliceKey, Set<CellKey>>; slicePivots: Map<SliceKey, CellKey>; markers: Marker[]; rigBoxes: RigBox[]; poses: Pose[]; poseCycle: PoseCycle | null } {
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
  // `noiseSeed` post-dates `ProjectMeta` being otherwise fully required. Default to 0 (the
  // hash functions' unseeded behavior) rather than a fresh random seed, so an old project's noise
  // looks exactly the same as it always did instead of visibly shifting on next load.
  // `voxelScaleY` is the same story one generation later: pre-scale files load as 1x (unit cubes).
  // `texelScale` one generation after that: pre-scale files load at full detail (4). The merged
  // meta must exist before the texture (whose face size derives from gridExtent + texelScale).
  const meta: ProjectMeta = { ...file.meta, noiseSeed: file.meta.noiseSeed ?? 0, voxelScaleY: file.meta.voxelScaleY ?? 1, texelScale: normalizeTexelScale(file.meta.texelScale ?? TEXEL_SCALE) }
  const texture = file.texture
    ? deserializeTexture(file.texture, meta.gridExtent, meta.texelScale!)
    : emptyTextureModel(meta.gridExtent, meta.texelScale!)
  const view: ViewSettings = { ambientOcclusion: false, noiseLevel: 0, specularNoiseLevel: 0, noiseScale: 1, aoStrength: 1, glassRoughnessLevel: 0.3, exposure: 1, exportScaleFactor: 100, exportAnchor: 'center', exportAlignToObjectBounds: false, exportDisableMeshOptimization: false, exportCullInteriorFaces: true, exportIncludeTextureMaps: true, exportIncludeAOMaps: true, exportIncludeMarkers: true, exportIncludeAnimations: true, ...file.view }
  const animSettings = file.animations ? deserializeAnimations(file.animations) : new Map()
  const sliceMasks = file.masks ? deserializeSliceMasks(file.masks) : new Map()
  const slicePivots = file.pivots ? deserializeSlicePivots(file.pivots) : new Map()
  // `emissiveAnim` was added to PaletteState after this field was already required elsewhere in the
  // palette shape — older files simply don't have it, so default-merge rather than bump the schema
  // (same treatment `exportAlignToObjectBounds` got for `view`).
  const palette: PaletteState = { ...DEFAULT_PALETTE, ...file.palette }
  const markers = deserializeMarkers(file.markers, meta.gridExtent)
  const rigBoxes = deserializeRigBoxes(file.rigBoxes, meta.gridExtent)
  const validBoxIds = new Set(rigBoxes.map((b) => b.id))
  const poses = deserializePoses(file.poses, validBoxIds)
  const poseCycle = deserializePoseCycle(file.poseCycle, new Set(poses.map((p) => p.id)))
  return { model: { ...built, bounds: recomputeBounds(built) }, palette, meta, texture, view, animSettings, sliceMasks, slicePivots, markers, rigBoxes, poses, poseCycle }
}
