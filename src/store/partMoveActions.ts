import type { StateCreator } from 'zustand'
import type { ChamferCell, ColorCell, Coord, SubdivCell } from '@/engine/grid/types'
import { decodeKey, encodeKey, recomputeBounds, withinWorkingBounds } from '@/engine/grid/GridStore'
import { cloneSubdiv } from '@/engine/grid/subdiv'
import { clampPartDelta, rigBoxContains, rigSubtreeIds, translateRigSubtree } from '@/engine/rigging/types'
import type { RigBox } from '@/engine/rigging/types'
import type { AppState, PartMoveActionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], PartMoveActionsSlice>

// Transient, not observable state — the cells being dragged this gesture plus the last-applied
// shift. Module-level (like moveActions' gesture) so it isn't drafted by Immer and doesn't
// churn React.
type PartMoveGesture = {
  boxId: string
  snapshot: Array<{ coord: Coord; color?: ColorCell; chamfer?: ChamferCell; subdiv?: SubdivCell }>
  placedKeys: string[]
  lastApplied: Coord
  /** Box list frozen at drag start (immutable snapshot — producers always replace the array,
   * never mutate it). Every tick re-derives box positions from this + the absolute delta, so
   * repeated updates can never compound. */
  boxes: RigBox[]
  /** Non-part cells the drag has covered, stashed on first overwrite so scrubbing back
   * restores them exactly — nothing is lost until the drop commits the fuse. Dropped with
   * the gesture (covered victims stay fused; uncovered ones were already restored). */
  victims: Map<string, { color?: ColorCell; chamfer?: ChamferCell; subdiv?: SubdivCell }>
}
let gesture: PartMoveGesture | null = null

const cloneChamfer = (c: ChamferCell): ChamferCell => ({
  planeAxis: c.planeAxis,
  planeOrientation: c.planeOrientation,
  resolvedTo: c.resolvedTo ? { ...c.resolvedTo } : null,
})

const now = () => new Date().toISOString()

/**
 * The part-move engine: an Animate-mode bind edit, not a pose. Dragging a rig-box footprint
 * relocates the box, its whole subtree, and the occupied voxels inside them as one part, so a
 * model can be assembled from separate pieces that are then parented ("glued") in the outline.
 *
 * Like the Move tool it snapshots the cells at drag start, then on each step clears the
 * previously-placed copies and re-lays the snapshot at the clamped absolute delta — scrubbing
 * back and forth is exact. Overlap fuses on drop: covered non-part cells are stashed on
 * first overwrite and restored the moment the part uncovers them, so dragging around can
 * never lose anything — only the release commits the fuse, and one undo restores it all.
 * Chamfer records ride along verbatim (never re-autotiled). The box-mapped texture and
 * markers are untouched: the gesture moves a part of the model, not the whole world.
 *
 * Undo is a single Animate-stack entry carrying boxes + voxels together (AnimSnapshot.model),
 * since undo is mode-routed and a split entry would strand half the gesture a mode-switch
 * away. The voxel history stack is never touched.
 */
export const createPartMoveActionsSlice: Slice = (set, get) => ({
  beginPartMove: (id) => {
    get().bakeFloatIfAny()
    const st = get()
    if (!st.rigBoxes.some((b) => b.id === id)) return false
    // Freeze the occupied payload: every live cell inside any moved box's volume. The set is
    // captured once (boxes sliding over new voxels mid-drag must not swallow them), and empty
    // boxes still arm the gesture so the box alone can slide.
    const moving = rigSubtreeIds(st.rigBoxes, id)
    const inPart = (coord: Coord): boolean => {
      for (const b of st.rigBoxes) {
        if (moving.has(b.id) && rigBoxContains(b, coord)) return true
      }
      return false
    }
    const snapshot: PartMoveGesture['snapshot'] = []
    const seen = new Set<string>()
    for (const key of st.model.color.keys()) {
      seen.add(key)
      const coord = decodeKey(key)
      if (!inPart(coord)) continue
      snapshot.push({ coord, color: st.model.color.get(key), chamfer: st.model.chamfer.get(key) })
    }
    // Chamfer cells always have a matching color cell — the union walk is belt-and-braces.
    // Subdiv parents have neither, so they need their own walk.
    for (const key of st.model.chamfer.keys()) {
      if (seen.has(key)) continue
      const coord = decodeKey(key)
      if (!inPart(coord)) continue
      snapshot.push({ coord, color: st.model.color.get(key), chamfer: st.model.chamfer.get(key) })
    }
    for (const key of st.model.subdiv.keys()) {
      const coord = decodeKey(key)
      if (!inPart(coord)) continue
      snapshot.push({ coord, subdiv: st.model.subdiv.get(key) })
    }

    gesture = { boxId: id, snapshot, placedKeys: snapshot.map((s) => encodeKey(...s.coord)), lastApplied: [0, 0, 0], boxes: st.rigBoxes, victims: new Map() }
    get().animBeginStroke()
    return true
  },

  updatePartMove: (delta) => {
    const g = gesture
    if (!g) return
    const st = get()
    // One shared wall-clamp for boxes and voxels: the largest shift fitting everything, so the
    // part can never shear apart at the working-cube wall. Overlap is allowed — covered
    // non-part cells are stashed below and fuse on drop, never silently lost mid-drag.
    const applied = clampPartDelta(
      g.boxes,
      g.boxId,
      g.snapshot.map((s) => s.coord),
      delta,
      st.meta.gridExtent,
    )
    if (applied[0] === g.lastApplied[0] && applied[1] === g.lastApplied[1] && applied[2] === g.lastApplied[2]) return
    set((state) => {
      const covered = new Set(
        g.snapshot.map((s) => encodeKey(s.coord[0] + applied[0], s.coord[1] + applied[1], s.coord[2] + applied[2])),
      )
      // Clear last frame's placement first (a covered victim's key may hold a part cell —
      // its stashed copy is what matters, restored below only when uncovered).
      for (const k of g.placedKeys) {
        state.model.color.delete(k)
        state.model.chamfer.delete(k)
        state.model.subdiv.delete(k)
      }
      // Restore stashed victims the part no longer covers; still-covered ones stay fused.
      for (const [key, cell] of g.victims) {
        if (covered.has(key)) continue
        if (cell.color) state.model.color.set(key, { paletteSlot: cell.color.paletteSlot })
        if (cell.chamfer) state.model.chamfer.set(key, cloneChamfer(cell.chamfer))
        if (cell.subdiv) state.model.subdiv.set(key, cloneSubdiv(cell.subdiv))
        g.victims.delete(key)
      }
      // Re-lay the snapshot at the new offset, stashing any non-part occupant first (part
      // cells only ever lived in the just-cleared placement, so anything left is foreign).
      const placed: string[] = []
      for (const cell of g.snapshot) {
        const nc: Coord = [cell.coord[0] + applied[0], cell.coord[1] + applied[1], cell.coord[2] + applied[2]]
        // Guaranteed by the clamp; kept as a guard so a future caller can't shear the part.
        if (!withinWorkingBounds(nc, state.meta.gridExtent)) continue
        const nk = encodeKey(...nc)
        // Copy everything out now — values behind a producer are drafts (and so is
        // any object they reference, like the palette slot) and must never escape into
        // the module-level gesture (same discipline as moveActions).
        if (!g.victims.has(nk) && (state.model.color.has(nk) || state.model.chamfer.has(nk) || state.model.subdiv.has(nk))) {
          const color = state.model.color.get(nk)
          const chamfer = state.model.chamfer.get(nk)
          const subdiv = state.model.subdiv.get(nk)
          g.victims.set(nk, {
            color: color ? { paletteSlot: { ...color.paletteSlot } } : undefined,
            chamfer: chamfer ? cloneChamfer(chamfer) : undefined,
            subdiv: subdiv ? cloneSubdiv(subdiv) : undefined,
          })
        }
        if (cell.color) state.model.color.set(nk, { paletteSlot: cell.color.paletteSlot })
        if (cell.chamfer) state.model.chamfer.set(nk, cloneChamfer(cell.chamfer))
        if (cell.subdiv) state.model.subdiv.set(nk, cloneSubdiv(cell.subdiv))
        placed.push(nk)
      }
      g.placedKeys = placed
      g.lastApplied = applied
      // Boxes re-derive from the frozen bind + the same validated shift — absolute, never
      // compounded — so boxes and voxels land in lockstep by construction.
      const nextBoxes = translateRigSubtree(g.boxes, g.boxId, applied, state.meta.gridExtent) ?? g.boxes
      state.rigBoxes = nextBoxes
      state.model.bounds = recomputeBounds(state.model)
      state.meta.modifiedAt = now()
      state.dirty = true
    })
  },

  endPartMove: () => {
    if (!gesture) return
    gesture = null
    // The anim bracket snapshots the model too, so a tap-without-drag nets zero change and
    // records nothing, while a real drag commits boxes + voxels as one undo entry.
    get().animCommitStroke()
  },
})
