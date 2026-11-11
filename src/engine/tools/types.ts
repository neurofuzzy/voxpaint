import type { Coord, GridExtent, SplitAxis, VoxelModel } from '@/engine/grid/types'
import type { Marker } from '@/engine/markers/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { NormalizedPointerEvent } from '@/engine/input/PointerInputController'
import type { ClipboardData, FloatOrigin, SelectionRegion, SelectionTransformKind, ToolId, VoxelKind } from '@/store/types'
import type { RigBox } from '@/engine/rigging/types'

/**
 * Everything a tool module needs, bundled into one object rebuilt fresh every render by the
 * React-side adapter (`usePixelCanvasTools`) and mirrored into a ref so pointer callbacks never
 * read stale closures. Read-only data fields (`model`, `plane`, `selection`, ...) are plain values;
 * mutations always go through the named action callbacks, which are thin bindings onto
 * `useAppStore.getState()` — tool modules never import the store directly, keeping them
 * framework/store-agnostic and unit-testable.
 */
export interface ToolContext {
  model: VoxelModel
  plane: ConstructionPlane
  gridExtent: GridExtent
  activeVoxelKind: VoxelKind
  activePaletteSlot: PaletteSlotRef
  selection: SelectionRegion | null
  /** The armed grid division (`pendingSplit`): sets the resolution of new selections. */
  gridSplit: SplitAxis[] | null
  floatContent: ClipboardData | null
  floatOrigin: FloatOrigin | null
  clipboard: ClipboardData | null

  paintCell: (u: number, v: number, qu?: number, qv?: number) => boolean
  eraseCell: (coord: [number, number, number], qu?: number, qv?: number) => void
  paintMaterialCell: (u: number, v: number, qu?: number, qv?: number) => boolean
  /** Texture-face rebase: re-authors the ramp/wedge at (u,v) onto the active plane's basis. */
  rebaseRampCell: (u: number, v: number) => boolean
  floodFill: (u: number, v: number) => void
  /** 3D connected fill, alt-click's variant — only meaningful when (u,v) is an existing voxel. */
  floodFill3D: (u: number, v: number) => void
  /** Animate-mode pivot tool: with a rig box selected it sets that box's rotation
   * center, otherwise it toasts that a selection is needed (slice pivots are legacy,
   * no longer authorable). Both self-bracket their own (Animate-mode-scoped) undo stroke. */
  setPivotForCurrentSlice: (u: number, v: number) => boolean
  /** Direct per-box pivot write (self-bracketed undo) — the pivot tool's two-click cycle. */
  setRigPivot: (id: string, pivot: [number, number, number] | null) => void
  clearPivotForCurrentSlice: () => void
  /** Animate-mode rig boxes (the mode's primary editable objects — the voxel model underneath
   * is a non-interactive underlay). Live store-backed so tools never read stale snapshots. */
  rigBoxes: RigBox[]
  selectedRigBoxId: string | null
  selectRigBox: (id: string | null) => void
  /** The keyframe under edit's per-box offsets (empty when none) — 2D footprint hit-testing
   * and drawing shift boxes by their composed offset so the editor agrees with the 3D
   * preview about where an offset box is. Live store-backed, like `rigBoxes`. */
  keyOffsets: Record<string, Coord>
  /** Translates a box's whole subtree WITHOUT its voxels (binding-volume slide only — the
   * part-move gesture below is the voxels-travel-along variant). No undo bracketing — the
   * caller owns the stroke. */
  translateRigBox: (id: string, delta: [number, number, number]) => void
  /** Part-move gesture (Animate mode): box + subtree + voxels travel as one part. The delta
   * is absolute world-space from the drag start (the slice clamps it to the working cube). */
  beginPartMove: (id: string) => boolean
  updatePartMove: (delta: [number, number, number]) => void
  endPartMove: () => void
  /** Offset drag (Animate mode, Offset tool): the dragged box's keyframe offset follows the
   * pointer in the slice plane. Absolute world-space delta from the drag start; the store
   * snaps the written total to the third-step lattice live, so the drag visibly steps
   * through thirds. Self-heals the key selection when none is under edit. */
  beginOffsetMove: (id: string) => boolean
  updateOffsetMove: (delta: [number, number, number]) => void
  endOffsetMove: () => void
  animBeginStroke: () => void
  animCommitStroke: () => void
  beginMove: (wholeModel: boolean) => void
  updateMove: (du: number, dv: number) => void
  endMove: () => void
  setActivePaletteSlot: (slot: PaletteSlotRef) => void
  setActiveVoxelKind: (kind: VoxelKind) => void
  setActiveTool: (tool: ToolId) => void
  setSelection: (region: SelectionRegion | null) => void
  /** Two-stage wand click (color, then whole-component on rapid re-tap). Wand stays active. */
  applyWandAt: (start: [number, number, number], fine?: [number, number]) => void
  /** Rig tool: tap empty space to box the tapped region, tap a footprint to select it, drag
   * a footprint to move its box across the slice. Rig tool stays active. */
  applyRigBoxAt: (start: [number, number, number]) => void
  /** Alt-drag passes `deep` to lift the full cuboid under the selection window (see
   * `liftSelectionToFloat` in store/types.ts). */
  liftSelectionToFloat: (deep?: boolean) => void
  moveFloatTo: (originU: number, originV: number, subU?: number, subV?: number) => void
  transformFloat: (kind: SelectionTransformKind) => void
  bakeFloatIfAny: () => void
  beginStroke: () => void
  commitStroke: () => void
  /** End-of-stroke bevel correction (see `PaintActionsSlice.correctChamferStroke`) — runs inside
   * the open stroke, before `commitStroke`. No-op outside a stroke or for non-bevel content. */
  correctChamferStroke: () => void

  /** Design markers (color-coded annotation points, not voxels). Live store-backed callbacks so
   * the marker tool never reads a stale render-time snapshot after its own writes. */
  markers: Marker[]
  selectedMarkerId: string | null
  /** Color index new markers are placed with (and taps recolor to). */
  activeMarkerColor: number
  /** Marker on the active plane slice at (u,v), or null. Reads live state. */
  markerAtCoord: (u: number, v: number) => Marker | null
  /** Adds a marker at (u,v)'s cell (bounds-checked, selects it). Returns the created marker, or
   * null when out of bounds. Bracketed by the caller's beginStroke/commitStroke. */
  addMarkerAtCoord: (u: number, v: number) => Marker | null
  /** Moves a marker to (u,v)'s cell (bounds-checked, no-op when out of bounds or unknown id).
   * Bracketed by the caller's beginStroke/commitStroke. */
  moveMarkerToCoord: (id: string, u: number, v: number) => void
  /** Recolors a marker (no-op on unknown id). Bracketed by the caller's beginStroke/commitStroke. */
  recolorMarker: (id: string, color: number) => void
  /** Deletes a marker (no-op on unknown id). Bracketed by the caller's beginStroke/commitStroke. */
  removeMarker: (id: string) => void
  selectMarker: (id: string | null) => void

  // Transient UI-only preview state (drag-in-progress rendering), backed by React state in the
  // adapter hook but exposed here so tool modules can read/write it without knowing that.
  linePreview: { anchor: [number, number]; end: [number, number] } | null
  setLinePreview: (v: { anchor: [number, number]; end: [number, number] } | null) => void
  selectPreview: SelectionRegion | null
  setSelectPreview: (v: SelectionRegion | null) => void

  /** Mutable drag-gesture scratch state, one shared ref per tool-context instance. Resets to
   * `idle` between gestures. */
  drag: { current: ToolDragState }
}

export type ToolDragState =
  | { kind: 'idle' }
  | { kind: 'paint'; anchor: [number, number]; last: [number, number]; anchorQuad?: [number, number] | null; lastQuad?: [number, number] | null }
  | { kind: 'selectRect'; anchor: [number, number]; /** Fine-unit anchor (sub-voxel resolution). */ fineAnchor?: [number, number] }
  | { kind: 'selectLasso'; points: Array<[number, number]> }
  | { kind: 'moveFloat'; startU: number; startV: number; originAtStart: FloatOrigin; /** Fine-unit pointer position at the start (sub-voxel floats). */ startFine?: [number, number];
    /**
     * Sub-voxel step recorded at lift time (the float's own resolution). The move uses this
     * instead of re-reading `floatContent`, which can lag a render behind on the lift gesture
     * itself — without it the first drag steps in whole voxels. Absent on old/whole drags,
     * which fall back to the live content.
     */
    fineStep?: { su: 1 | 2; sv: 1 | 2 } }
  | { kind: 'moveGrid'; startU: number; startV: number; lastU: number; lastV: number }
  | { kind: 'marker'; id: string }
  /** Marker tap candidate: pointer went down on an existing marker but hasn't dragged off it
   * yet. A release here resolves to recolor-or-delete; leaving the start cell converts to a
   * `marker` move drag instead. */
  | { kind: 'marker-pending'; id: string; startU: number; startV: number }
  /** Rig-box part-move gesture (Animate mode): pointer went down on a box footprint and is
   * sliding its part across the slice. Start is the press cell in logical (u,v); moves pass
   * the absolute world-space delta from there (offset-axis component always 0). */
  | { kind: 'rig-move'; id: string; startU: number; startV: number }
  /** Offset drag (Animate mode, Offset tool): pointer went down on a box footprint and is
   * sliding its keyframe offset across the slice. Same absolute-delta semantics; startCu/
   * startCv carry the press's continuous display position (absent on synthetic events, which
   * fall back to whole-cell deltas) so sub-cell pointer motion yields fractional offsets. */
  | { kind: 'offset-move'; id: string; startU: number; startV: number; startCu?: number; startCv?: number }

export interface ToolHandler {
  onDown?(ctx: ToolContext, e: NormalizedPointerEvent): void
  onMove?(ctx: ToolContext, e: NormalizedPointerEvent): void
  onUp?(ctx: ToolContext, e: NormalizedPointerEvent): void
}
