import type { Axis, CellKey, ChamferCell, Coord, GridExtent, Orientation, VoxelModel } from '@/engine/grid/types'
import type { GltfExportAnchor } from '@/engine/export/gltfExport'
import type { EmissiveAnimMode, PaletteSlotRef, PaletteState } from '@/engine/palette/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { ProjectMeta } from '@/engine/persistence/schema'
import type { BoxFace, TextureModel } from '@/engine/texture/types'
import type { TexelClip } from '@/engine/texture/texelOps'
import type { AnimationSpeed, AnimationType, SliceAnimSettings, SliceKey } from '@/engine/animation/types'

export type ToolId = 'paint' | 'erase' | 'eyedropper' | 'select' | 'fill' | 'clone' | 'move' | 'pivot'
export type VoxelKind = 'cube' | 'ramp' | 'wedge'

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
  /** Sets the blink/pulse animation mode for one emissive palette slot (0–3). */
  setEmissiveAnimMode: (index: number, mode: EmissiveAnimMode) => void
  setProjectName: (name: string) => void
  /** Re-rolls `meta.noiseSeed`, changing the baked noise/specular grain's pattern without touching
   * the model — for when the current project's noise happened to land on an unflattering roll. */
  randomizeNoiseSeed: () => void
  newProject: (name: string, gridExtent: GridExtent) => void
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
  /** 3D preview: apply coplanar-face merge on top of the CSG shell for maximum triangle reduction. */
  optimizedMesh: boolean
  /** 3D preview: apply baked ambient occlusion (only visible in the optimized-mesh PBR view). */
  ambientOcclusion: boolean
  /** 3D preview: intensity of monochromatic noise baked into the AO texture (0–1, default 0 = off). */
  noiseLevel: number
  /** 3D preview: intensity of specular noise on metal materials (0–1, default 0 = off). */
  specularNoiseLevel: number
  /** 3D preview: roughness level for glass materials (0–1, default 0.3 = slightly frosted). */
  glassRoughnessLevel: number
  /** Last-known triangle counts from the optimized-mesh builder for the header stats line. */
  meshTriangles: { optimized: number; raw: number } | null
  /** 3D preview: AO strength multiplier applied during bake (1.0–5.0, default 1.0). */
  aoStrength: number
  /** 3D preview: renderer tone-mapping exposure (0.1–4, default 1.0). Applied on top of
   * NeutralToneMapping (Canvas.tsx), so it's the user-facing lever for brightness since the
   * baked-in light intensities can't be tuned by eye from here. */
  exposure: number
  /** Dynamic status message shown in the footer's center area. Components set this on hover to
   * show contextual info; cleared on pointer leave. Falls back to the active tool hint when null. */
  statusMessage: string | null
  /** Texture mode: show the 3D model silhouette as a ghosted guide behind the texel grid. */
  onionSkin: boolean
  /** GLTF export: scale factor as a percentage (1–1000, default 100). */
  exportScaleFactor: number
  /** GLTF export: anchor point (center, bottom, back). */
  exportAnchor: GltfExportAnchor
  /** GLTF export: anchor relative to the voxels' own AABB instead of the canvas origin. */
  exportAlignToObjectBounds: boolean
  setFullscreen: (v: boolean) => void
  setHoverCell: (coord: Coord | null, chamferValid: boolean | null) => void
  setHoveredFace: (face: HoveredFace | null) => void
  setWireframe: (v: boolean) => void
  setOptimizedMesh: (v: boolean) => void
  setAmbientOcclusion: (v: boolean) => void
  setNoiseLevel: (v: number) => void
  setSpecularNoiseLevel: (v: number) => void
  setGlassRoughnessLevel: (v: number) => void
  setMeshTriangles: (v: { optimized: number; raw: number } | null) => void
  setExposure: (v: number) => void
  setAoStrength: (v: number) => void
  setStatusMessage: (msg: string | null) => void
  setOnionSkin: (v: boolean) => void
  setExportScaleFactor: (v: number) => void
  setExportAnchor: (v: GltfExportAnchor) => void
  setExportAlignToObjectBounds: (v: boolean) => void
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

/** The top-level authoring mode. `model` = voxel modeling (the original app); `animate` = per-slice
 * animation assignment (same 2D/3D views as model, animation palette instead of color palette);
 * `texture` = box-mapped surface texturing. The one shared switch every mode-aware component keys off. */
export type EditorMode = 'model' | 'animate' | 'texture'

export type ModeSlice = {
  mode: EditorMode
  setMode: (mode: EditorMode) => void
}

/**
 * Texture authoring state — a fully parallel stack to the voxel one (its own model, selection/float/
 * clipboard, and **independent** undo/redo history), so texturing never touches voxel history and
 * vice versa. Operates on the active box face's flat texel grid.
 */
export type TextureSlice = {
  texture: TextureModel
  /** Which of the 6 box faces the 2D canvas edits, or null until the user clicks a face in 3D. */
  activeBoxFace: BoxFace | null
  /** Active grayscale index (0..4) the texture brush writes. */
  activeGrayIndex: number

  /** Separate undo/redo stacks — whole-`TextureModel` snapshots, one per completed gesture. */
  texturePast: TextureModel[]
  textureFuture: TextureModel[]

  /** Texel selection/float/clipboard, mirroring the voxel selection subsystem on a flat grid. */
  textureSelection: SelectionRegion | null
  textureFloat: TexelClip | null
  textureFloatOrigin: FloatOrigin | null
  textureClipboard: TexelClip | null

  setTexture: (texture: TextureModel) => void
  setActiveBoxFace: (face: BoxFace | null) => void
  setActiveGrayIndex: (index: number) => void

  textureBeginStroke: () => void
  textureCommitStroke: () => void
  textureUndo: () => void
  textureRedo: () => void

  /** Paints/erases/fills the active face at texel (u,v). Clipped to the active selection mask and
   * face bounds; no-op when no box face is active. */
  paintTexel: (u: number, v: number) => void
  eraseTexel: (u: number, v: number) => void
  floodFillTexel: (u: number, v: number) => void
  cloneStampTexel: (srcU: number, srcV: number, destU: number, destV: number) => void

  /** Live Move of the whole active-face texel grid (one undo stroke). */
  beginTextureMove: () => void
  updateTextureMove: (du: number, dv: number) => void
  endTextureMove: () => void

  setTextureSelection: (region: SelectionRegion | null) => void
  textureLiftToFloat: () => void
  textureMoveFloatTo: (originU: number, originV: number) => void
  textureTransformFloat: (kind: SelectionTransformKind) => void
  textureBakeFloatIfAny: () => void
  textureCopy: () => void
  textureCut: () => void
  textureDelete: () => void
  texturePasteAt: (u: number, v: number) => void
}

export type AnimationSlice = {
  /** Per-slice animation settings keyed by encodeSliceKey(axis, offset). */
  animSettings: Map<SliceKey, SliceAnimSettings>
  /** Per-slice animation mask: which occupied cells of that slice actually animate, keyed by
   * encodeSliceKey(axis, offset). Absent or empty for a slice means "animate the whole slice"
   * (the pre-mask default behavior). */
  sliceMasks: Map<SliceKey, Set<CellKey>>
  /** Per-slice rotation/pendulum pivot override, keyed by encodeSliceKey(axis, offset) — the pivot
   * cell's own key (its world center is the cell's coordinate +0.5 per axis). Absent for a slice
   * means "use the inferred bounding-box center" (the pre-pivot default behavior). Ignored by slide
   * animation types. At most one entry per slice — setting a new pivot replaces the old one. */
  slicePivots: Map<SliceKey, CellKey>
  /** Undo/redo stacks for animation changes (independent of model undo) — one shared stack for
   * both animation-settings changes and mask paint strokes, since both are Animate-mode-only
   * edits a user expects to undo together. */
  animPast: AnimSnapshot[]
  animFuture: AnimSnapshot[]

  /** Set or clear the animation for a slice. Wrapped in begin/commit stroke for undo. */
  setAnimSettingsForSlice: (axis: Axis, offset: number, settings: SliceAnimSettings | null) => void
  /** Remove all animation settings, masks, and pivots (e.g. on new project). */
  clearAllAnimations: () => void

  /** Set the animation type for the current construction-plane slice, carrying over its existing
   * speed/slideAmount/swingAmount (or defaults for a previously unanimated slice). Passing 'none'
   * clears it. */
  setAnimationTypeForCurrentSlice: (type: AnimationType) => void
  /** Set the animation speed for the current slice, defaulting the rest of its settings if unset. */
  setAnimationSpeedForCurrentSlice: (speed: AnimationSpeed) => void
  /** Set the slide amount for the current slice, defaulting the rest of its settings if unset. */
  setSlideAmountForCurrentSlice: (amount: number) => void
  /** Set the pendulum swing amount (degrees) for the current slice, defaulting the rest of its
   * settings if unset. */
  setSwingAmountForCurrentSlice: (amount: number) => void

  /** Paints one cell of the current plane's slice into its animation mask. Only occupied cells
   * (voxels that already hold color) can be masked. Returns false when out of bounds or empty. */
  paintMaskCell: (u: number, v: number) => boolean
  /** Removes one cell from the current plane's slice's animation mask. Deletes the slice's mask
   * entirely once it becomes empty, reverting to whole-slice-animates. */
  eraseMaskCell: (coord: Coord) => void

  /** Sets (replacing any existing one) the current construction-plane slice's rotation/pendulum
   * pivot to the cell at plane-space (u,v) — occupied or not. Self-brackets its own undo stroke.
   * Returns false when out of bounds. */
  setPivotForCurrentSlice: (u: number, v: number) => boolean
  /** Clears the current slice's pivot override, reverting to the inferred bounding-box center.
   * Self-brackets its own undo stroke. */
  clearPivotForCurrentSlice: () => void

  animBeginStroke: () => void
  animCommitStroke: () => void
  animUndo: () => void
  animRedo: () => void
}

/** One Animate-mode undo/redo snapshot: animation settings, mask paint state, and pivots travel together. */
export type AnimSnapshot = {
  animSettings: Map<SliceKey, SliceAnimSettings>
  sliceMasks: Map<SliceKey, Set<CellKey>>
  slicePivots: Map<SliceKey, CellKey>
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
  MoveActionsSlice &
  ModeSlice &
  TextureSlice &
  AnimationSlice
