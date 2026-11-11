import type { PaletteSlotRef } from '@/engine/palette/types'

export type Axis = 'x' | 'y' | 'z'
export type Orientation = 1 | -1
export type Rotation = 0 | 1 | 2 | 3
export type ChamferShapeKind = 'ramp' | 'convex' | 'concave' | 'wedge' | 'thin' | 'half' | 'post' | 'quarter' | 'flat' | 'flatwedge'

/** Locked-in project size (edge length of the working cube), chosen at project creation and
 * editable thereafter in Project Settings (`updateProjectSettings` — growing keeps everything,
 * shrinking clips out-of-bounds voxels). An integer in `[2, MAX_GRID_EXTENT]` — presets (8/16/24)
 * or a Custom value. Odd sizes are allowed for a centered "pillar": internally the engine always
 * works on an even grid (`effectiveExtent` rounds odd up by one), and the 2D/3D views nudge their
 * framing by half a cell (`viewOriginShift`) so the center column reads dead-centre. See GridStore.ts. */
export type GridExtent = number

/** Project-level Y voxel scale: world height of one voxel as a multiple of its X/Z footprint.
 * 1 renders and exports unit cubes; 0.5 flattens (ramps read ~26.6°), 2 stretches tall (trees).
 * The grid itself stays integer — scale applies only at presentation boundaries (3D scene,
 * 2D X/Z-plane views, baked export vertices), never to paint/clipboard/texture math. */
export type VoxelScaleY = 0.5 | 1 | 2

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

/**
 * One subdivided voxel: a plain cube replaced by 2, 4, or 8 half-scale children along the
 * split world axes (one subdivision level only — children never subdivide further). Stored
 * as one `SubdivCell` under the parent's CellKey; the parent's `color`/`chamfer` cells are
 * removed while subdivided. Detail children hold any voxel content, scaled to fill their
 * subcell's bounding box at render/export — chamfer shapes are frozen explicit kinds, never
 * autotiled or re-resolved (the resolver stays unit-scale).
 */
export type SplitAxis = 'x' | 'y' | 'z'

/**
 * Global edit grid: the toolbar's 4-way picker. Whole paints unit voxels; half, quarter,
 * and octal arm a world-axis division that paint/fill writes split to just-in-time.
 * The armed division lives in the store's pendingSplit; this names which button owns it.
 */
export type GridFamily = 'whole' | 'half' | 'quarter' | 'octal'

export type DetailChild = {
  slot: PaletteSlotRef
  /** Frozen explicit shape, scaled to fill the subcell's bounding box. Absent = plain cube. */
  chamfer?: ChamferCell
}

export type SubdivCell = {
  /** The parent's original slot, stored so coarsening restores it exactly. */
  slot: PaletteSlotRef
  /** Split world axes, 1–3 distinct, in x,y,z order. Children = 2^split.length. */
  split: SplitAxis[]
  /** Per-child slots in split-bit order (see `splitChildIndex`) — `null` = erased. */
  children: (DetailChild | null)[]
  /**
   * True when the entry was split from empty space (a paint scaffold, not a real voxel).
   * All children start null; coarsening deletes the entry instead of restoring a cube.
   * An all-null non-scaffold is impossible — erasing the last child deletes the entry.
   */
  scaffold?: boolean
}

export type VoxelModel = {
  /** Plain cubic voxels, keyed by CellKey. Treat as immutable outside of Immer producers. */
  color: Map<CellKey, ColorCell>
  /** Chamfered voxels, keyed by CellKey. A chamfer cell always has a matching color cell. */
  chamfer: Map<CellKey, ChamferCell>
  /** Subdivided voxels, keyed by the PARENT CellKey. A subdiv parent has no color/chamfer cell. */
  subdiv: Map<CellKey, SubdivCell>
  bounds: BBox | null
}
