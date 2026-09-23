import type { ToolId } from '@/store/types'
import type { ToolHandler } from './types'
import { paintTool } from './paintTool'
import { eraseTool } from './eraseTool'
import { eyedropperTool } from './eyedropperTool'
import { materialTool } from './materialTool'
import { selectTool } from './selectTool'
import { fillTool } from './fillTool'
import { cloneTool } from './cloneTool'
import { moveTool } from './moveTool'
import { maskPaintTool, maskEraseTool } from './maskTools'
import { markerTool } from './markerTool'
import { pivotTool } from './pivotTool'
import { textureFaceTool } from './textureFaceTool'

export type { ToolHandler, ToolContext, ToolDragState } from './types'

export const toolMap: Record<ToolId, ToolHandler> = {
  paint: paintTool,
  erase: eraseTool,
  eyedropper: eyedropperTool,
  material: materialTool,
  select: selectTool,
  fill: fillTool,
  clone: cloneTool,
  move: moveTool,
  textureface: textureFaceTool,
  marker: markerTool,
  // Pivot only exists in Animate mode's toolbar (see ToolPalette.tsx's ANIMATE_TOOLS) — this is a
  // harmless no-op fallback for the (normally unreachable) case where `activeTool` is still
  // 'pivot' after switching out of Animate mode.
  pivot: {},
}

/** Animate-mode tool dispatch: paint/erase/pivot have meaning here (painting the current slice's
 * animation mask, or setting its rotation/pendulum pivot) — everything else is a no-op. */
export const animateToolMap: Partial<Record<ToolId, ToolHandler>> = {
  paint: maskPaintTool,
  erase: maskEraseTool,
  pivot: pivotTool,
}
