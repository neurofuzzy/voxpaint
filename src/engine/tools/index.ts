import type { EditorMode, ToolId } from '@/store/types'
import type { ToolHandler } from './types'
import { paintTool } from './paintTool'
import { eraseTool } from './eraseTool'
import { eyedropperTool } from './eyedropperTool'
import { materialTool } from './materialTool'
import { selectTool } from './selectTool'
import { fillTool } from './fillTool'
import { moveTool } from './moveTool'
import { markerTool } from './markerTool'
import { pivotTool } from './pivotTool'
import { textureFaceTool } from './textureFaceTool'
import { wandTool } from './wandTool'
import { rigWandTool } from './rigWandTool'

export type { ToolHandler, ToolContext, ToolDragState } from './types'

export const toolMap: Record<ToolId, ToolHandler> = {
  paint: paintTool,
  erase: eraseTool,
  eyedropper: eyedropperTool,
  material: materialTool,
  select: selectTool,
  fill: fillTool,
  move: moveTool,
  textureface: textureFaceTool,
  marker: markerTool,
  // Wand selects a touching component's bbox footprint (2D click or 3D tap) — model-mode only.
  wand: wandTool,
  // Rig wand boxes a material-class-connected region as a named rig selection — animate-mode only.
  rigbox: rigWandTool,
  // Pivot only exists in Animate mode's toolbar (see ToolPalette.tsx's ANIMATE_TOOLS) — this is a
  // harmless no-op fallback for the (normally unreachable) case where `activeTool` is still
  // 'pivot' after switching out of Animate mode.
  pivot: {},
}

/** Animate-mode tool dispatch: only the rig tools have meaning here (boxing/selecting/moving
 * boxes, pinning their pivots) — the voxel model is a non-interactive underlay, so everything
 * else is a no-op. Slice-loop masks from old files still play back; they just can't be
 * authored anymore. */
export const animateToolMap: Partial<Record<ToolId, ToolHandler>> = {
  pivot: pivotTool,
  rigbox: rigWandTool,
}

/** Gesture-tool resolution for pointer dispatch (see usePixelCanvasTools.ts).
 *
 * Spring-loaded pivot lives here as well as in the keyboard shortcut: holding Alt turns a
 * rig-tool press into a pivot press, so it behaves exactly like the pivot tool itself.
 * Resolving it from the *pointer* event's own `altKey` (instead of only from the Alt-keydown
 * toolbar switch) keeps the gesture correct when the keydown never fires — e.g. keyboard
 * focus sitting in the rig-name field, where the shortcut handler deliberately stays out of
 * the way — and the hook's per-gesture affinity keeps the matching onMove/onUp on this tool
 * even if Alt (and with it the toolbar) flips back mid-gesture. Outside Animate's rig tool
 * this is the identity. */
export function resolveGestureTool(mode: EditorMode, activeTool: ToolId, altKey: boolean): ToolId {
  if (mode === 'animate' && activeTool === 'rigbox' && altKey) return 'pivot'
  return activeTool
}
