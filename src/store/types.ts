import type { Coord, VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef, PaletteState } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { ProjectMeta } from '@/engine/persistence/schema'

export type ToolId = 'paint' | 'eyedropper' | 'select' | 'fill' | 'clone' | 'move'
export type ActiveLayer = 'color' | 'chamfer'

export type SelectionRegion = {
  originU: number
  originV: number
  width: number
  height: number
  mask: Uint8Array
}

export type ClipboardCell = {
  du: number
  dv: number
  color?: { paletteSlot: PaletteSlotRef }
  chamfer?: { rotation: number }
}

export type ClipboardData = {
  width: number
  height: number
  cells: ClipboardCell[]
}

export type ProjectSlice = {
  model: VoxelModel
  palette: PaletteState
  meta: ProjectMeta
  setModel: (model: VoxelModel) => void
  setPalette: (palette: PaletteState) => void
  newProject: () => void
}

export type HistorySlice = {
  past: VoxelModel[]
  future: VoxelModel[]
  beginStroke: () => void
  commitStroke: () => void
  undo: () => void
  redo: () => void
}

export type PlaneSlice = {
  plane: ConstructionPlane
  setPlaneAxisOrientation: (axis: ConstructionPlane['axis'], orientation: ConstructionPlane['orientation']) => void
  setPlaneOffset: (offset: number) => void
}

export type ToolSlice = {
  activeTool: ToolId
  activeLayer: ActiveLayer
  activePaletteSlot: PaletteSlotRef
  setActiveTool: (tool: ToolId) => void
  setActiveLayer: (layer: ActiveLayer) => void
  setActivePaletteSlot: (slot: PaletteSlotRef) => void
}

export type SelectionSlice = {
  selection: SelectionRegion | null
  clipboard: ClipboardData | null
  setSelection: (region: SelectionRegion | null) => void
  setClipboard: (clipboard: ClipboardData | null) => void
}

export type ViewSlice = {
  fullscreen: boolean
  hoverCell: Coord | null
  chamferHoverValid: boolean | null
  setFullscreen: (v: boolean) => void
  setHoverCell: (coord: Coord | null, chamferValid: boolean | null) => void
}

export type PersistenceSlice = {
  dirty: boolean
  lastSavedAt: string | null
  lastError: string | null
  markDirty: () => void
  markSaved: (at: string) => void
  setError: (message: string | null) => void
}

export type PaintActionsSlice = {
  /** Writes a color-layer cell. Returns false (no-op) if outside the 64^3 working bounds. */
  paintColorCell: (coord: Coord) => boolean
  /**
   * Validates + writes a chamfer-layer cell at plane-space (u,v), plus the color layer at the
   * same cell using the active palette slot (spec: chamfer paint always also sets color).
   * Returns false (no-op) if the neighbor configuration is invalid or out of bounds.
   */
  paintChamferCell: (u: number, v: number) => boolean
  eraseCell: (coord: Coord, layer: ActiveLayer) => void
}

export type AppState = ProjectSlice &
  HistorySlice &
  PlaneSlice &
  ToolSlice &
  SelectionSlice &
  ViewSlice &
  PersistenceSlice &
  PaintActionsSlice
