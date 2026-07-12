import type { Axis, CellKey, ChamferCell, Coord, Orientation, VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef, PaletteState } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { ProjectMeta } from '@/engine/persistence/schema'

export type ToolId = 'paint' | 'erase' | 'eyedropper' | 'select' | 'fill' | 'clone' | 'move'
export type VoxelKind = 'cube' | 'ramp'

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
  /** The source cell's full chamfer data (plane basis + resolved shape), copied verbatim and
   * restored on paste with no reclassification — the pasted shape exactly matches the source. A
   * chamfer only ever (re)resolves when the user edits that specific voxel. */
  chamfer?: ChamferCell
}

export type ClipboardData = {
  width: number
  height: number
  cells: ClipboardCell[]
  /** (u,v) top-left of the region this was copied from, so paste lands in the same spot
   * (paste-in-place). Present on clipboard copies; omitted on transformed float content, which
   * tracks position via `floatOrigin` instead. */
  originU?: number
  originV?: number
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

/** The voxel/face last landed on via a 3D face-click, while still eligible for a same-voxel
 * second click to advance the plane through that face. Cleared by any other plane change. */
export type ObjectModeTarget = { cellKey: CellKey; axis: Axis; orientation: Orientation; offset: number }

export type PlaneSlice = {
  plane: ConstructionPlane
  objectModeTarget: ObjectModeTarget | null
  setPlaneAxisOrientation: (axis: ConstructionPlane['axis'], orientation: ConstructionPlane['orientation']) => void
  setPlaneOffset: (offset: number) => void
  /**
   * Handles a 3D face-click on a voxel (spec: first click lands the construction plane on the
   * clicked voxel's own slice; clicking the SAME voxel again advances the plane one step forward
   * through that same face, into the adjacent empty slice).
   */
  handleVoxelFaceClick: (cellKey: CellKey, axis: Axis, orientation: Orientation, offset: number) => void
}

export type ToolSlice = {
  activeTool: ToolId
  activeVoxelKind: VoxelKind
  activePaletteSlot: PaletteSlotRef
  setActiveTool: (tool: ToolId) => void
  setActiveVoxelKind: (kind: VoxelKind) => void
  setActivePaletteSlot: (slot: PaletteSlotRef) => void
}

export type FloatOrigin = { originU: number; originV: number }

export type SelectionSlice = {
  selection: SelectionRegion | null
  clipboard: ClipboardData | null
  /** Non-null while a Move-lift or paste is pending, uncommitted, and still movable/transformable. */
  floatContent: ClipboardData | null
  /** Current placement of `floatContent`. Always non-null exactly when `floatContent` is. */
  floatOrigin: FloatOrigin | null
  setSelection: (region: SelectionRegion | null) => void
  setClipboard: (clipboard: ClipboardData | null) => void
}

/** The specific voxel face currently under the pointer in the 3D view — live, updates on every
 * hover move (including between faces of the same voxel). Drives VoxelFaceHighlight; a click
 * commits the plane to whichever face is current at click time (see handleVoxelFaceClick). */
export type HoveredFace = { cellKey: CellKey; axis: Axis; orientation: Orientation }

export type ViewSlice = {
  fullscreen: boolean
  hoverCell: Coord | null
  chamferHoverValid: boolean | null
  hoveredFace: HoveredFace | null
  /** 3D preview: render the mesh as wireframe (applies to both the instanced and optimized views). */
  wireframe: boolean
  /** 3D preview: replace the instanced voxels with a single merged, coplanar-optimized shell mesh. */
  optimizedMesh: boolean
  setFullscreen: (v: boolean) => void
  setHoverCell: (coord: Coord | null, chamferValid: boolean | null) => void
  setHoveredFace: (face: HoveredFace | null) => void
  setWireframe: (v: boolean) => void
  setOptimizedMesh: (v: boolean) => void
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
  /**
   * Paints a cell at plane-space (u,v) using the active vault kind and palette slot.
   * 'cube' writes only color (deletes any existing chamfer). 'ramp' writes both color and chamfer
   * (auto-resolved from neighbors). Returns false if out of bounds.
   */
  paintCell: (u: number, v: number) => boolean
  /** Erases both color and chamfer layers at a cell. */
  eraseCell: (coord: Coord) => void
}

export type SelectionTransformKind = 'rotate' | 'mirror-h' | 'mirror-v'

export type ToolActionsSlice = {
  /** Flood fill (color layer only, spec §2) starting at plane-space (u,v). One undo stroke. */
  floodFill: (u: number, v: number) => void
  /** Clones whatever is at (srcU,srcV) onto (destU,destV), both layers, re-validating chamfer. */
  cloneStampCell: (srcU: number, srcV: number, destU: number, destV: number) => void
  copySelection: () => void
  cutSelection: () => void
  deleteSelection: () => void
  /** Pastes the clipboard as a new floating selection at (u,v) — does not commit to the model. */
  pasteClipboardAt: (u: number, v: number) => void
  /** Lifts the current selection into a floating buffer: copies it out, clears the source cells,
   * and opens an undo stroke that stays uncommitted until `bakeFloatIfAny()`. No-op if nothing is
   * selected or a float is already pending. */
  liftSelectionToFloat: () => void
  /** Repositions the pending float. Pure — no model writes, no undo-stroke activity. */
  moveFloatTo: (originU: number, originV: number) => void
  /** Rotates/mirrors the pending float in place (auto-lifting first if nothing is floating yet).
   * Pure — no model writes. */
  transformFloat: (kind: SelectionTransformKind) => void
  /** Bakes the pending float into the model (re-validating chamfer at its destination) and closes
   * the undo stroke opened by the lift/paste. No-op if nothing is floating. Call this before any
   * other action that touches `model` or reads it for a "current" snapshot. */
  bakeFloatIfAny: () => void
}

export type MoveActionsSlice = {
  /** Starts a Move-tool drag: snapshots the cells to translate (current plane slice, or the whole
   * model when `wholeModel`) and opens one undo stroke. No selection, no float. */
  beginMove: (wholeModel: boolean) => void
  /** Live-translates the snapshotted cells by a plane-space (du,dv) offset from the drag start. */
  updateMove: (du: number, dv: number) => void
  /** Ends the Move drag and commits the undo stroke. */
  endMove: () => void
}

export type AppState = ProjectSlice &
  HistorySlice &
  PlaneSlice &
  ToolSlice &
  SelectionSlice &
  ViewSlice &
  PersistenceSlice &
  PaintActionsSlice &
  ToolActionsSlice &
  MoveActionsSlice
