import { decodeKey, emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import { CURRENT_SCHEMA_VERSION, type ProjectMeta, type VoxPaintProjectFile } from './schema'

export function serializeProject(model: VoxelModel, palette: PaletteState, meta: ProjectMeta): VoxPaintProjectFile {
  const colorCells = Array.from(model.color.entries()).map(([key, cell]) => {
    const [x, y, z] = decodeKey(key)
    return { x, y, z, paletteSlot: cell.paletteSlot }
  })
  const chamferCells = Array.from(model.chamfer.entries()).map(([key, cell]) => {
    const [x, y, z] = decodeKey(key)
    return { x, y, z, ...cell }
  })
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta,
    palette,
    model: { bounds: model.bounds, colorCells, chamferCells },
  }
}

export function deserializeProject(file: VoxPaintProjectFile): { model: VoxelModel; palette: PaletteState; meta: ProjectMeta } {
  const model = emptyModel()
  const color = new Map(model.color)
  const chamfer = new Map(model.chamfer)

  for (const cell of file.model.colorCells) {
    color.set(encodeKey(cell.x, cell.y, cell.z), { paletteSlot: cell.paletteSlot })
  }
  for (const cell of file.model.chamferCells) {
    chamfer.set(encodeKey(cell.x, cell.y, cell.z), {
      planeAxis: cell.planeAxis,
      planeOrientation: cell.planeOrientation,
      resolvedTo: cell.resolvedTo,
    })
  }

  const built: VoxelModel = { color, chamfer, bounds: file.model.bounds }
  return { model: { ...built, bounds: recomputeBounds(built) }, palette: file.palette, meta: file.meta }
}
