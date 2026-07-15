import type { ToolId } from '@/store/types'
import type { ToolHandler } from './types'
import { paintTool } from './paintTool'
import { eraseTool } from './eraseTool'
import { eyedropperTool } from './eyedropperTool'
import { selectTool } from './selectTool'
import { fillTool } from './fillTool'
import { cloneTool } from './cloneTool'
import { moveTool } from './moveTool'
import { maskPaintTool, maskEraseTool } from './maskTools'

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

/** Animate-mode tool dispatch: only paint/erase have a meaning (painting the current slice's
 * animation mask), everything else is a no-op there. */
export const animateToolMap: Partial<Record<ToolId, ToolHandler>> = {
  paint: maskPaintTool,
  erase: maskEraseTool,
}
