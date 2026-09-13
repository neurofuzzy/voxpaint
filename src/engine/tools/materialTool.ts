import { makeEditTool } from './editToolFactory'
import type { ToolHandler } from './types'

/**
 * Material paint: recolors occupied voxels with the active palette slot — existing voxels only,
 * never adds or deletes cells, never touches chamfer. Drag-supported (recoloring is idempotent,
 * so crossing faces can't pile anything up); the store action no-ops same-slot repaints so
 * empty drags don't record junk undo steps.
 */
export const materialTool: ToolHandler = makeEditTool((ctx, u, v) => {
  ctx.paintMaterialCell(u, v)
})
