import type { ToolId } from '@/store/types'
import type { ToolHandler } from './types'
import { paintTool } from './paintTool'
import { eraseTool } from './eraseTool'
import { eyedropperTool } from './eyedropperTool'
import { selectTool } from './selectTool'
import { fillTool } from './fillTool'
import { cloneTool } from './cloneTool'
import { moveTool } from './moveTool'

export type { ToolHandler, ToolContext, ToolDragState } from './types'

export const toolMap: Record<ToolId, ToolHandler> = {
  paint: paintTool,
  erase: eraseTool,
  eyedropper: eyedropperTool,
  select: selectTool,
  fill: fillTool,
  clone: cloneTool,
  move: moveTool,
}
