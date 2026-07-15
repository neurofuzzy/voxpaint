import type { AnimationType, AnimationSpeed } from '@/engine/animation/types'
import type { Axis, BBox, ChamferClassification, GridExtent, Orientation } from '@/engine/grid/types'
import type { PaletteSlotRef, PaletteState } from '@/engine/palette/types'
import type { BoxFace } from '@/engine/texture/types'
import type { GltfExportAnchor } from '@/engine/export/gltfExport'

export const CURRENT_SCHEMA_VERSION = 6 as const

export type ViewSettings = {
  ambientOcclusion: boolean
  noiseLevel: number
  specularNoiseLevel: number
  aoStrength: number
  glassRoughnessLevel: number
  exposure: number
  exportScaleFactor: number
  exportAnchor: GltfExportAnchor
}

export type ProjectMeta = {
  name: string
  createdAt: string // ISO 8601
  modifiedAt: string
  /** Locked in at project creation (see engine/grid/types.ts `GridExtent`) — never changes after. */
  gridExtent: GridExtent
}

export type SerializedColorCell = { x: number; y: number; z: number; paletteSlot: PaletteSlotRef }
export type SerializedChamferCell = {
  x: number
  y: number
  z: number
  planeAxis: Axis
  planeOrientation: Orientation
  /** Null if this cell hadn't resolved a shape yet when the project was saved — it stays
   * unresolved (rendered as a plain cube) until enough neighbors are painted around it. */
  resolvedTo: ChamferClassification | null
}

/** The box-mapped texture, serialized: per-face grayscale texel arrays as base64. `texelScale` and
 * `faceSize` are recorded so a future grid-size change can detect (and skip) incompatible textures. */
export type SerializedTexture = {
  texelScale: number
  faceSize: number
  faces: Record<BoxFace, string>
}

export type SerializedAnimLayer = {
  axis: Axis
  offset: number
  animationType: AnimationType
  speed: AnimationSpeed
  slideAmount: number
}

/** A slice's animation mask: which of its occupied cells (by "x,y,z" key) actually animate.
 * Absent/empty means "animate the whole slice" (see engine/animation/animationLayers.ts). */
export type SerializedSliceMask = {
  axis: Axis
  offset: number
  cellKeys: string[]
}

export type VoxPaintProjectFileV1 = {
  schemaVersion: 1
  meta: ProjectMeta
  palette: PaletteState
  model: {
    bounds: BBox | null
    colorCells: SerializedColorCell[]
    chamferCells: SerializedChamferCell[]
  }
}

export type VoxPaintProjectFileV2 = {
  schemaVersion: 2
  meta: ProjectMeta
  palette: PaletteState
  model: {
    bounds: BBox | null
    colorCells: SerializedColorCell[]
    chamferCells: SerializedChamferCell[]
  }
  /** Optional — absent on projects that were never textured (and on migrated v1 files). */
  texture?: SerializedTexture
}

/** v3: the palette's `blink`/`pulse` groups were replaced by `metal`/`glass` (material classes, since
 * glTF can't animate). Structurally identical to v2 otherwise; the v2→v3 migration reshapes the
 * palette and remaps any `blink`/`pulse` cell references to `emissive` (see migrations.ts).
 * The optional `view` field stores 3D-viewport settings (noise, AO strength) added after the v3
 * schema was frozen; absent on older files, defaulting to `{ noiseLevel: 0, aoStrength: 1 }`.
 *
 * v4: adds an optional `animations` array for per-slice animation settings (axis, offset, type, speed).
 *
 * v5: adds an optional `masks` array for per-slice animation masks (which occupied cells of a
 * slice animate, vs the whole slice).
 *
 * v6: `meta.gridExtent` becomes required — the project's locked-in working-cube size, chosen at
 * creation (see engine/grid/types.ts `GridExtent`). Older files didn't have per-project sizing at
 * all (every project used the same fixed 16 extent), so the v5→v6 migration just stamps `16`. */
export type VoxPaintProjectFile = {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION
  meta: ProjectMeta
  palette: PaletteState
  model: {
    bounds: BBox | null
    colorCells: SerializedColorCell[]
    chamferCells: SerializedChamferCell[]
  }
  texture?: SerializedTexture
  view?: ViewSettings
  animations?: SerializedAnimLayer[]
  masks?: SerializedSliceMask[]
}
