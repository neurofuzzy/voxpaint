import type { VoxelModel } from '@/engine/grid/types'
import type { ConstructionPlane } from '@/engine/plane/types'
import type { PaletteSlotRef } from '@/engine/palette/types'
import type { NormalizedPointerEvent } from '@/engine/input/PointerInputController'
import type { ClipboardData, FloatOrigin, SelectionRegion, SelectionTransformKind, ToolId, VoxelKind } from '@/store/types'

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
  activeVoxelKind: VoxelKind
  activePaletteSlot: PaletteSlotRef
  selection: SelectionRegion | null
  floatContent: ClipboardData | null
  floatOrigin: FloatOrigin | null
  clipboard: ClipboardData | null

  paintCell: (u: number, v: number) => boolean
  eraseCell: (coord: [number, number, number]) => void
  floodFill: (u: number, v: number) => void
  /** Animate-mode mask paint/erase, plus its own (Animate-mode-scoped) undo stroke bracket —
   * separate from the voxel model's beginStroke/commitStroke above. */
  paintMaskCell: (u: number, v: number) => boolean
  eraseMaskCell: (coord: [number, number, number]) => void
  /** Animate-mode pivot tool: sets/clears the current slice's rotation/pendulum pivot. Both
   * self-bracket their own (Animate-mode-scoped) undo stroke. */
  setPivotForCurrentSlice: (u: number, v: number) => boolean
  clearPivotForCurrentSlice: () => void
  animBeginStroke: () => void
  animCommitStroke: () => void
  beginMove: (wholeModel: boolean) => void
  updateMove: (du: number, dv: number) => void
  endMove: () => void
  cloneStampCell: (srcU: number, srcV: number, destU: number, destV: number) => void
  setActivePaletteSlot: (slot: PaletteSlotRef) => void
  setActiveTool: (tool: ToolId) => void
  setSelection: (region: SelectionRegion | null) => void
  liftSelectionToFloat: () => void
  moveFloatTo: (originU: number, originV: number) => void
  transformFloat: (kind: SelectionTransformKind) => void
  bakeFloatIfAny: () => void
  beginStroke: () => void
  commitStroke: () => void

  // Transient UI-only preview state (drag-in-progress rendering), backed by React state in the
  // adapter hook but exposed here so tool modules can read/write it without knowing that.
  linePreview: { anchor: [number, number]; end: [number, number] } | null
  setLinePreview: (v: { anchor: [number, number]; end: [number, number] } | null) => void
  selectPreview: SelectionRegion | null
  setSelectPreview: (v: SelectionRegion | null) => void

  /** Mutable drag-gesture scratch state, one shared ref per tool-context instance. Resets to
   * `idle` between gestures. */
  drag: { current: ToolDragState }

  /** Clone tool's source anchor, set by alt-click and persisting *across* separate drag gestures
   * (aligned clone-stamp behavior) — lives outside `drag` because `drag` resets to idle on every
   * pointer-up, but the source/offset must survive until a new alt-click resets them. */
  cloneSourceRef: { current: [number, number] | null }
  cloneOffsetRef: { current: [number, number] | null }
}

export type ToolDragState =
  | { kind: 'idle' }
  | { kind: 'paint'; anchor: [number, number]; last: [number, number] }
  | { kind: 'selectRect'; anchor: [number, number] }
  | { kind: 'selectLasso'; points: Array<[number, number]> }
  | { kind: 'clone'; last: [number, number] }
  | { kind: 'moveFloat'; startU: number; startV: number; originAtStart: FloatOrigin }
  | { kind: 'moveGrid'; startU: number; startV: number; lastU: number; lastV: number }

export interface ToolHandler {
  onDown?(ctx: ToolContext, e: NormalizedPointerEvent): void
  onMove?(ctx: ToolContext, e: NormalizedPointerEvent): void
  onUp?(ctx: ToolContext, e: NormalizedPointerEvent): void
}
