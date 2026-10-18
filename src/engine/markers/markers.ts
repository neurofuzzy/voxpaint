import { withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Axis, Coord, GridExtent, Orientation, VoxelScaleY } from '@/engine/grid/types'
import { MARKER_COLORS, type Marker, type MarkerColor } from './types'

let markerCounter = 0

function newMarkerId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    markerCounter += 1
    return `marker-${Date.now()}-${markerCounter}`
  }
}

/** Creates a marker at a grid cell with the given color and draw-time plane basis. */
export function createMarker(position: Coord, color: MarkerColor, planeAxis: Axis, planeOrientation: Orientation): Marker {
  return {
    id: newMarkerId(),
    color,
    position: [...position] as Coord,
    planeAxis,
    planeOrientation,
  }
}

/** Resolves a marker's color index to its hex string, falling back to the first color. */
export function markerColorHex(color: MarkerColor): string {
  return MARKER_COLORS[color] ?? MARKER_COLORS[0]
}

/** World-space center of a marker's cell, in the same unit-cube voxel units the export meshes use. */
export function markerWorldCenter(position: Coord, voxelScaleY: VoxelScaleY = 1): [number, number, number] {
  return [position[0] + 0.5, (position[1] + 0.5) * voxelScaleY, position[2] + 0.5]
}

/** True when the marker's cell is inside the project's working bounds. */
export function markerInBounds(marker: Marker, extent: GridExtent): boolean {
  return withinWorkingBounds(marker.position, extent)
}

/**
 * Human direction word for a marker's facing (matches the 3D view's voxel-hint compass:
 * east/west on x, up/down on y, south/north on z). Used in node names, the markers panel,
 * and hover status so the facing reads without decoding axis/orientation pairs.
 */
export function markerDirectionWord(planeAxis: Axis, planeOrientation: Orientation): string {
  const dirs: Record<Axis, Record<number, string>> = {
    x: { 1: 'east', '-1': 'west' },
    y: { 1: 'up', '-1': 'down' },
    z: { 1: 'south', '-1': 'north' },
  }
  return dirs[planeAxis]?.[planeOrientation] ?? planeAxis
}

/**
 * Unique glTF node name for a marker: color hex + facing direction + id prefix, so downstream
 * tools can distinguish markers by name alone. Deduped against `taken` with a numeric suffix.
 */
export function markerNodeName(marker: Marker, taken: Set<string>): string {
  const base = `marker_${markerColorHex(marker.color).replace('#', '')}_${markerDirectionWord(marker.planeAxis, marker.planeOrientation)}_${marker.id.slice(0, 8)}`
  let name = base
  let n = 2
  while (taken.has(name)) {
    name = `${base}_${n}`
    n += 1
  }
  taken.add(name)
  return name
}
