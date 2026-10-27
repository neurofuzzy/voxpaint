import type { StateCreator } from 'zustand'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import type { Coord } from '@/engine/grid/types'
import { bboxOfCoords } from '@/engine/tools/cellSetOps'
import { floodFillRegion3D } from '@/engine/tools/floodFill'
import type { RigBox } from '@/engine/rigging/types'
import { moveRigBoxInList, translateRigSubtree, type RigMovePosition } from '@/engine/rigging/types'
import { showToast } from '@/components/ui/toastBus'
import type { AppState, RiggingSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], RiggingSlice>

function newRigId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `rig-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`
  }
}

function uniqueRigName(base: string, boxes: RigBox[]): string {
  const taken = new Set(boxes.map((b) => b.name))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function nextDefaultName(boxes: RigBox[]): string {
  let i = boxes.length + 1
  while (boxes.some((b) => b.name === `rig-${i}`)) i++
  return `rig-${i}`
}

export const createRiggingSlice: Slice = (set, get) => ({
  rigBoxes: [],
  selectedRigBoxId: null,

  addRigBox: (box) => {
    get().animBeginStroke()
    set((state) => {
      const name = uniqueRigName(box.name.trim() || nextDefaultName(state.rigBoxes), state.rigBoxes)
      const parentId = box.parentId && state.rigBoxes.some((b) => b.id === box.parentId) ? box.parentId : null
      state.rigBoxes.push({ ...box, id: box.id || newRigId(), name, parentId, pivot: box.pivot ?? null })
      state.selectedRigBoxId = state.rigBoxes[state.rigBoxes.length - 1].id
      state.dirty = true
    })
    get().animCommitStroke()
  },

  renameRigBox: (id, name) => {
    const clean = name.trim().slice(0, 64)
    if (!clean) return
    get().animBeginStroke()
    set((state) => {
      const box = state.rigBoxes.find((b) => b.id === id)
      if (!box) return
      const others = state.rigBoxes.filter((b) => b.id !== id)
      box.name = uniqueRigName(clean, others)
      state.dirty = true
    })
    get().animCommitStroke()
  },

  deleteRigBox: (id) => {
    get().animBeginStroke()
    set((state) => {
      const deleted = state.rigBoxes.find((b) => b.id === id)
      state.rigBoxes = state.rigBoxes
        .filter((b) => b.id !== id)
        // Promote orphans: children of the deleted box move up to its parent.
        .map((b) => (b.parentId === id ? { ...b, parentId: deleted?.parentId ?? null } : b))
      if (state.selectedRigBoxId === id) state.selectedRigBoxId = null
      state.dirty = true
    })
    get().animCommitStroke()
  },

  moveRigBox: (dragId, targetId, position: RigMovePosition) => {
    const next = moveRigBoxInList(get().rigBoxes, dragId, targetId, position)
    if (!next) return
    get().animBeginStroke()
    set((state) => {
      state.rigBoxes = next
      state.selectedRigBoxId = dragId
      state.dirty = true
    })
    get().animCommitStroke()
  },

  selectRigBox: (id) => {
    set((state) => {
      state.selectedRigBoxId = id
    })
  },

  setRigPivot: (id, pivot) => {
    // Pivots are continuous grid points (integers = cell centers, half-integers = cell
    // boundaries for joint faces) — only finiteness is required, not integrality.
    if (pivot && !pivot.every((n) => Number.isFinite(n))) return
    get().animBeginStroke()
    set((state) => {
      const box = state.rigBoxes.find((b) => b.id === id)
      if (!box) return
      box.pivot = pivot ? ([...pivot] as Coord) : null
      state.dirty = true
    })
    get().animCommitStroke()
  },

  translateRigBox: (id, delta) => {
    const next = translateRigSubtree(get().rigBoxes, id, delta, get().meta.gridExtent)
    if (!next) return
    set((state) => {
      state.rigBoxes = next
      state.dirty = true
    })
  },

  setSelectedRigPivot: (pivot) => {
    const { selectedRigBoxId, rigBoxes } = get()
    if (!selectedRigBoxId || !rigBoxes.some((b) => b.id === selectedRigBoxId)) {
      showToast('Select a rig box in the outline first — the Pivot tool sets the selected box\u2019s rotation center')
      return false
    }
    get().setRigPivot(selectedRigBoxId, pivot)
    return true
  },

  clearAllRigBoxes: () =>
    set((state) => {
      state.rigBoxes = []
      state.selectedRigBoxId = null
    }),

  applyRigBoxAt: (start: Coord) => {
    const { model, meta } = get()
    const startKey = encodeKey(...start)
    if (!model.color.has(startKey)) {
      showToast('Rig: tap an occupied voxel to box its color-connected region')
      return
    }
    const keys = floodFillRegion3D(model, start, meta.gridExtent)
    if (keys.length === 0) return
    const coords = keys.map((k) => decodeKey(k))
    const bbox = bboxOfCoords(coords)
    if (!bbox) return
    // An exact twin adds nothing (export ties break by list order, so it could never win) —
    // select it instead of duplicating. Unreachable from the 2D tool (footprint hit-testing
    // selects first), but guards stale double-fires and any future caller.
    const dupe = get().rigBoxes.find(
      (b) =>
        b.min[0] === bbox.min[0] && b.min[1] === bbox.min[1] && b.min[2] === bbox.min[2] &&
        b.max[0] === bbox.max[0] && b.max[1] === bbox.max[1] && b.max[2] === bbox.max[2],
    )
    if (dupe) {
      get().selectRigBox(dupe.id)
      showToast(`Rig: already boxed as ${dupe.name}`)
      return
    }
    get().animBeginStroke()
    set((state) => {
      const name = nextDefaultName(state.rigBoxes)
      const box: RigBox = {
        id: newRigId(),
        name: uniqueRigName(name, state.rigBoxes),
        min: [...bbox.min] as Coord,
        max: [...bbox.max] as Coord,
        parentId: null,
        pivot: null,
      }
      state.rigBoxes.push(box)
      state.selectedRigBoxId = box.id
      state.dirty = true
    })
    get().animCommitStroke()
    const current = get().rigBoxes[get().rigBoxes.length - 1]
    const [dx, dy, dz] = [
      current.max[0] - current.min[0] + 1,
      current.max[1] - current.min[1] + 1,
      current.max[2] - current.min[2] + 1,
    ]
    showToast(`Rig: ${current.name} — ${keys.length} voxels, ${dx}×${dy}×${dz} box`)
  },
})
