import type { PaletteSlotRef } from '@/engine/palette/types'

export type Axis = 'x' | 'y' | 'z'
export type Orientation = 1 | -1
export type Rotation = 0 | 1 | 2 | 3
export type ChamferShapeKind = 'ramp' | 'convex' | 'concave'

/** Grid coordinate, always integer. Mutable tuple (not readonly) so Immer drafts accept it directly. */
export type Coord = [x: number, y: number, z: number]

/** Sparse-map key for a grid coordinate. See `encodeKey`/`decodeKey`. */
export type CellKey = string

export type ColorCell = {
  paletteSlot: PaletteSlotRef
}

export type ChamferCell = {
  shapeKind: ChamferShapeKind
  rotation: Rotation
  /** Construction plane active at paint time — frozen, never reinterpreted later. */
  planeAxis: Axis
  planeOrientation: Orientation
}

export type BBox = {
  min: Coord
  max: Coord
}

export type VoxelModel = {
  /** Plain cubic voxels, keyed by CellKey. Treat as immutable outside of Immer producers. */
  color: Map<CellKey, ColorCell>
  /** Chamfered voxels, keyed by CellKey. A chamfer cell always has a matching color cell. */
  chamfer: Map<CellKey, ChamferCell>
  bounds: BBox | null
}
