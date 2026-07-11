import type { Axis, BBox, ChamferClassification, Orientation } from '@/engine/grid/types'
import type { PaletteSlotRef, PaletteState } from '@/engine/palette/types'

export const CURRENT_SCHEMA_VERSION = 1 as const

export type ProjectMeta = {
  name: string
  createdAt: string // ISO 8601
  modifiedAt: string
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

export type VoxPaintProjectFile = VoxPaintProjectFileV1
