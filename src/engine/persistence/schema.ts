import type { Axis, BBox, ChamferShapeKind, Orientation, Rotation } from '@/engine/grid/types'
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
  shapeKind: ChamferShapeKind
  rotation: Rotation
  planeAxis: Axis
  planeOrientation: Orientation
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
