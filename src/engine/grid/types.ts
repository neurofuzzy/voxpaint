import type { PaletteSlotRef } from '@/engine/palette/types'

export type Axis = 'x' | 'y' | 'z'
export type Orientation = 1 | -1
export type Rotation = 0 | 1 | 2 | 3
export type ChamferShapeKind = 'ramp' | 'convex' | 'concave' | 'wedge'

/** Locked-in project size (edge length of the working cube), chosen once at project creation and
 * never changed after. Small/Medium/Large — all well under `MAX_GRID_EXTENT`. */
export type GridExtent = 8 | 16 | 24

/** Grid coordinate, always integer. Mutable tuple (not readonly) so Immer drafts accept it directly. */
export type Coord = [x: number, y: number, z: number]

/** Sparse-map key for a grid coordinate. See `encodeKey`/`decodeKey`. */
export type CellKey = string

export type ColorCell = {
  paletteSlot: PaletteSlotRef
}

export type ChamferClassification = {
  shapeKind: ChamferShapeKind
  rotation: Rotation
}

export type ChamferCell = {
  /** Construction plane active at paint time — frozen, never reinterpreted later. */
  planeAxis: Axis
  planeOrientation: Orientation
  /**
   * The resolved shape, or `null` if this cell's neighbor configuration doesn't (yet) resolve to
   * a valid ramp/convex/concave shape. Painting a chamfer cell always succeeds even when
   * unresolved — it renders as a plain cube until it resolves. Resolution is (re-)attempted
   * whenever a chamfer paint happens on the same (axis, offset) plane slice
   * (`engine/chamfer/chamferResolver.ts`'s `resolveChamferCellsOnPlane`); once non-null, it's
   * frozen forever, same as the old "resolved once at paint time" rule just deferred until it's
   * actually resolvable.
   */
  resolvedTo: ChamferClassification | null
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
