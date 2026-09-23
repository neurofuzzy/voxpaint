import { withinWorkingBounds } from '@/engine/grid/GridStore'
import type { Coord, GridExtent, VoxelScaleY } from '@/engine/grid/types'
import type { Marker } from './types'

let markerCounter = 0

function newMarkerId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    markerCounter += 1
    return `marker-${Date.now()}-${markerCounter}`
  }
}

/**
 * Creates a marker at a grid cell. The label defaults to `Marker N` where N
 * is one more than the existing marker count (caller passes it in so this
 * stays pure and unit-testable).
 */
export function createMarker(position: Coord, existingCount: number, label?: string): Marker {
  return {
    id: newMarkerId(),
    label: label ?? `Marker ${existingCount + 1}`,
    position: [...position] as Coord,
  }
}

/** World-space center of a marker's cell, in the same unit-cube voxel units the export meshes use. */
export function markerWorldCenter(position: Coord, voxelScaleY: VoxelScaleY = 1): [number, number, number] {
  return [position[0] + 0.5, (position[1] + 0.5) * voxelScaleY, position[2] + 0.5]
}

/** True when the marker's cell is inside the project's working bounds. */
export function markerInBounds(marker: Marker, extent: GridExtent): boolean {
  return withinWorkingBounds(marker.position, extent)
}

/** Strips a label down to glTF-node-safe characters; falls back to "marker". */
export function sanitizeMarkerLabel(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return (cleaned || 'marker').slice(0, 64)
}

/**
 * Unique, human-readable glTF node name for a marker. Deduped against
 * `taken` (already-emitted names) with a numeric suffix.
 */
export function markerNodeName(marker: Marker, taken: Set<string>): string {
  const base = `marker_${sanitizeMarkerLabel(marker.label)}_${marker.id.slice(0, 8)}`
  let name = base
  let n = 2
  while (taken.has(name)) {
    name = `${base}_${n}`
    n += 1
  }
  taken.add(name)
  return name
}
