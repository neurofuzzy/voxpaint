import type { StateCreator } from 'zustand'
import { produce } from 'immer'
import { showToast } from '@/components/ui/toastBus'
import type { Coord, VoxelModel } from '@/engine/grid/types'
import { decodeKey, effectiveExtent, recomputeBounds } from '@/engine/grid/GridStore'
import { clearFineRegion } from '@/engine/grid/fineOps'
import { pixelFromGridCoord, planeLogicalBasis } from '@/engine/plane/constructionPlane'
import type { ConstructionPlane } from '@/engine/plane/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { cloneTextureModel, hasTextureContent, normalizeTexelScale } from '@/engine/texture/TextureStore'
import { textureContentEquals, transformTextureWholeModel, translateTextureModelWrap } from '@/engine/texture/textureTransform'
import { TEXEL_SCALE } from '@/engine/texture/types'
import type { TextureModel } from '@/engine/texture/types'
import { copyCellsToClipboard } from '@/engine/tools/cellSetOps'
import { clearRegion, copyRegionToClipboard } from '@/engine/tools/clipboard'
import { draggedFloatOrigin, floatDragStep, placeFloat, settleFloatOrigin } from '@/engine/tools/fineFloat'
import { regionFromFineCells } from '@/engine/tools/fineSelection'
import { rectRegion } from '@/engine/tools/selectionMask'
import type { AppState, ClipboardData, FloatOrigin, MoveActionsSlice, SelectionRegion } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], MoveActionsSlice>

// Transient, not observable state — what this gesture moves and the model it lays it back onto.
// Module-level (like historySlice's strokeBaseline) so it isn't drafted by Immer and doesn't
// churn React.
type MoveGesture = {
  /** The model as it was at press time — restored exactly when the drag returns to its start. */
  original: VoxelModel
  /** The model with the moved content lifted out (never in the store; each step lays the
   * content back onto a fresh copy of it). */
  base: VoxelModel
  /** The moved content, as a float (whole cells, or the plane's slab when the grid cuts the plane
   * axis), and where it was lifted from. */
  clip: ClipboardData
  start: FloatOrigin
  /** The grid's in-plane step at press time (`floatDragStep`) — the units `updateMove` takes. */
  step: { su: 1 | 2; sv: 1 | 2 }
  plane: ConstructionPlane
  uDir: Coord
  vDir: Coord
  /** Said once per gesture: whole bevels can't take a half-voxel step. */
  warnedAtomic: boolean
  /** Deep copy of the box-map faces when this drag carries the texture along (whole-model,
   * no-selection drags in Model mode with painted texels) — every `updateMove` re-derives the
   * live texture from this base so scrubbing back and forth is exact. Null otherwise. */
  textureBase: TextureModel | null
}
let gesture: MoveGesture | null = null

/** Every occupied cell key (any layer). */
function occupiedKeys(model: VoxelModel): Set<string> {
  const keys = new Set<string>()
  for (const k of model.color.keys()) keys.add(k)
  for (const k of model.chamfer.keys()) keys.add(k)
  for (const k of model.subdiv.keys()) keys.add(k)
  return keys
}

/**
 * The region a slice move lifts: the occupied cells of the plane's slice, at the grid's depth —
 * just the plane's slab when the grid cuts the plane axis (a fine region, so only that half moves),
 * whole voxels otherwise. Null when the slice is empty.
 */
function sliceRegion(plane: ConstructionPlane, keys: Iterable<string>): SelectionRegion | null {
  const ai = axisIndex(plane.axis)
  const cells: Array<[number, number]> = []
  for (const key of keys) {
    const coord = decodeKey(key)
    if (coord[ai] !== plane.offset) continue
    const { u, v } = pixelFromGridCoord(plane, coord)
    cells.push([u, v])
  }
  if (cells.length === 0) return null
  const region = regionFromFineCells({ su: 1, sv: 1, slab: null }, cells)!
  if (plane.half === null) return region
  return { ...region, fine: { su: 1, sv: 1, slab: plane.half, mask: new Uint8Array(region.mask) } }
}

/**
 * The Move tool's engine: a **direct, live translation** of voxels — no selection, no float. It
 * lifts the content to move (the current plane slice — only the plane's half-voxel slab when the
 * grid cuts the plane axis — or, with `wholeModel` (Alt-drag), every cell), then on each drag step
 * lays it back onto the lifted-out model at the dragged offset, all inside one undo stroke. The
 * drag follows the grid: `updateMove` takes deltas in the grid's in-plane step (half voxels along
 * each in-plane axis the grid cuts — `floatDragStep`, which callers use to measure the pointer),
 * and off-lattice positions land as pieces exactly like a dropped float (`placeFloat`). Content
 * holding whole chamfer cells keeps whole-voxel positions (`settleFloatOrigin`). Content dragged
 * out of the working box is simply not placed, but stays in the gesture so it reappears if
 * dragged back.
 *
 * A whole-model drag with no voxel selection also carries the box-mapped texture along (same
 * world delta, faces wrapped toroidally so nothing scrolls away) as one texture-undo step —
 * slice moves and selection-scoped edits leave the global box map untouched.
 */
export const createMoveActionsSlice: Slice = (set, get) => ({
  beginMove: (wholeModel: boolean) => {
    get().bakeFloatIfAny()
    const st = get()
    const { model, plane } = st
    const { uDir, vDir } = planeLogicalBasis(plane.axis)
    const keys = occupiedKeys(model)

    let clip: ClipboardData | null = null
    let base: VoxelModel = model
    if (wholeModel) {
      // Bbox-anchored exact-set copy: every cell keeps its absolute depth.
      if (keys.size > 0) {
        clip = copyCellsToClipboard(model, keys, plane)
        base = produce(model, (m) => {
          for (const k of keys) {
            m.color.delete(k)
            m.chamfer.delete(k)
            m.subdiv.delete(k)
          }
          m.bounds = recomputeBounds(m)
        })
      }
    } else {
      const region = sliceRegion(plane, keys)
      if (region) {
        clip = copyRegionToClipboard(model, plane, region)
        base = produce(model, (m) => {
          if (region.fine) clearFineRegion(m, plane, region)
          else clearRegion(m, plane, region)
          m.bounds = recomputeBounds(m)
        })
      }
    }

    // Only an unscoped whole-model drag moves the texture: a slice move or an active
    // selection/float means the voxels being moved aren't the whole model, so the global box
    // map stays put. An unpainted texture arms nothing (no junk undo step).
    const textureBase =
      wholeModel && st.mode === 'model' && st.selection === null && st.floatContent === null && hasTextureContent(st.texture)
        ? cloneTextureModel(st.texture)
        : null
    if (textureBase) get().textureBeginStroke()

    gesture = {
      original: model,
      base,
      clip: clip ?? { width: 0, height: 0, cells: [], copyPlaneAxis: plane.axis, copyPlaneOrientation: plane.orientation, copyPlaneOffset: plane.offset },
      start: { originU: clip?.originU ?? 0, originV: clip?.originV ?? 0 },
      step: floatDragStep(plane, st.gridSplit) ?? { su: 1, sv: 1 },
      plane: { ...plane },
      uDir,
      vDir,
      warnedAtomic: false,
      textureBase,
    }
    get().beginStroke()
  },

  updateMove: (du: number, dv: number) => {
    const g = gesture
    if (!g) return
    const raw = draggedFloatOrigin(g.start, g.step, du, dv)
    const at = settleFloatOrigin(g.clip, raw)
    if (!g.warnedAtomic && ((raw.subU ?? 0) !== (at.subU ?? 0) || (raw.subV ?? 0) !== (at.subV ?? 0))) {
      g.warnedAtomic = true
      showToast('Whole bevels move in whole voxels — the half step snaps to the nearest voxel')
    }
    // World travel in voxels (half voxels included), for the texture.
    const tu = at.originU - g.start.originU + (at.subU ?? 0) * 0.5
    const tv = at.originV - g.start.originV + (at.subV ?? 0) * 0.5
    const s = get()
    const extent = s.meta.gridExtent
    // Back at the start (or nothing to move): the press-time model itself — no change, so a
    // click, a return trip, or an empty slice records nothing.
    const atStart = (tu === 0 && tv === 0) || g.clip.cells.length === 0
    const nextModel = atStart
      ? g.original
      : produce(g.base, (m) => {
        placeFloat(m, g.plane, g.clip, at, extent)
        m.bounds = recomputeBounds(m)
      })
    // Rebuilt outside the producer (Uint8Array faces are Immer-opaque — same discipline as
    // textureSlice's copy-on-write), then assigned in.
    let nextTexture: TextureModel | null = null
    if (g.textureBase) {
      const worldDelta: Coord = [
        tu * g.uDir[0] + tv * g.vDir[0],
        tu * g.uDir[1] + tv * g.vDir[1],
        tu * g.uDir[2] + tv * g.vDir[2],
      ]
      nextTexture = translateTextureModelWrap(
        g.textureBase,
        worldDelta,
        extent,
        normalizeTexelScale(s.meta.texelScale ?? TEXEL_SCALE),
      )
    }
    if (nextModel === s.model && !nextTexture) return
    set((state) => {
      state.model = nextModel
      if (nextTexture) state.texture = nextTexture
      if (nextModel !== g.original) {
        state.meta.modifiedAt = new Date().toISOString()
        state.dirty = true
      }
    })
  },

  endMove: () => {
    if (!gesture) return
    const { textureBase } = gesture
    gesture = null
    get().commitStroke()
    if (textureBase) {
      // A click-without-drag (or a full-wrap move) nets zero texture change — abandon the
      // stroke instead of recording a junk undo step.
      if (textureContentEquals(get().texture, textureBase)) get().textureCancelStroke()
      else get().textureCommitStroke()
    }
  },

  transformWholeModel: (kind) => {
    // Model mode only — the voxel selection/float stack doesn't exist in Texture mode.
    if (get().mode !== 'model') return
    // A select-all + deep-lift + transform + bake, as one gesture: the full-span window covers
    // every cell, the deep lift carries all depths, the float transform renumbers chamfers in
    // the plane frame, and the bake lands back in place (rotation about the grid origin). One
    // undo stroke (lift opens, bake commits); the working selection is cleared afterwards so
    // later paints aren't clipped to it.
    get().bakeFloatIfAny()
    // Only an unscoped transform carries the texture: with an active selection/float the user
    // scoped the gesture at a subset, so the global box map stays put. Captured before the
    // select-all below overwrites it.
    const hadSelection = get().selection !== null || get().floatContent !== null
    const half = effectiveExtent(get().meta.gridExtent) / 2
    get().setSelection(rectRegion(-half, -half, half - 1, half - 1))
    get().liftSelectionToFloat(true)
    get().transformFloat(kind)
    get().bakeFloatIfAny()
    get().setSelection(null)
    if (!hadSelection) {
      const s = get()
      if (!hasTextureContent(s.texture)) return
      const next = transformTextureWholeModel(
        s.texture,
        kind,
        s.plane.axis,
        s.meta.gridExtent,
        normalizeTexelScale(s.meta.texelScale ?? TEXEL_SCALE),
      )
      if (textureContentEquals(next, s.texture)) return
      get().textureBeginStroke()
      set((state) => {
        state.texture = next
        state.dirty = true
        state.meta.modifiedAt = new Date().toISOString()
      })
      get().textureCommitStroke()
    }
  },
})
