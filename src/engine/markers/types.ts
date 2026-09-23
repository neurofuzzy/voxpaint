import type { Coord } from '@/engine/grid/types'

/**
 * The fixed marker color set. Markers deliberately don't use the voxel color palette — they
 * are composition annotations ("put another GLB here"), not paint, so they get their own
 * small, highly-distinguishable set. Stored on the marker as an index into this array.
 */
export const MARKER_COLORS = ['#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#e879f9'] as const

/** Index into `MARKER_COLORS`. */
export type MarkerColor = number

/**
 * A design marker: a colored, non-voxel annotation point at a grid cell.
 * Markers are never part of the voxel model (no bounds, mesh, texture, or
 * animation participation) — they exist so downstream tools can compose
 * external content ("put another GLB here") at color-coded points.
 */
export type Marker = {
  id: string
  color: MarkerColor
  /** Grid cell the marker sits on. Render/export position is the cell center. */
  position: Coord
}

export type SerializedMarkerPosition = {
  id: string
  color: MarkerColor
  x: number
  y: number
  z: number
}
