import type { Coord } from '@/engine/grid/types'

/**
 * A design marker: a labeled, non-voxel annotation point at a grid cell.
 * Markers are never part of the voxel model (no bounds, mesh, texture, or
 * animation participation) — they exist so downstream tools can compose
 * external content ("put another GLB here") at labeled points.
 */
export type Marker = {
  id: string
  label: string
  /** Grid cell the marker sits on. Render/export position is the cell center. */
  position: Coord
}

export type SerializedMarkerPosition = {
  id: string
  label: string
  x: number
  y: number
  z: number
}
