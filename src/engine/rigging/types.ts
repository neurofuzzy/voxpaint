import type { Coord } from '@/engine/grid/types'

/**
 * A named rigging selection: an axis-aligned bounding box in grid coordinates (inclusive
 * min/max corners). Boxes are decoupled from the model — they name whatever voxels happen to
 * lie inside at GLTF export time, and survive model edits untouched.
 *
 * Hierarchy: `parentId` links a box into the rig outline (null = root). Export emits nested
 * `Group` nodes, so the outline reads as a joint tree downstream. Overlap resolution is
 * deepest-first (a nested box wins over its ancestors), ties broken by list order.
 */
export type RigBox = {
  id: string
  name: string
  min: Coord
  max: Coord
  /** Parent box id, or null for a root box. */
  parentId: string | null
}

/** Serialized rig box (project file v12+). Coords are plain triples. */
export type SerializedRigBox = {
  id: string
  name: string
  min: [number, number, number]
  max: [number, number, number]
  /** Absent on pre-hierarchy files — loads as a root box. */
  parentId?: string | null
}

/** GLTF-safe mesh name: letters, digits, `_`, `-` ( Blender/Unity-friendly). */
export function sanitizeRigName(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 64)
  return cleaned.length > 0 ? cleaned : fallback
}

/** Inclusive bbox containment test. */
export function rigBoxContains(box: RigBox, coord: Coord): boolean {
  return (
    coord[0] >= box.min[0] && coord[0] <= box.max[0] &&
    coord[1] >= box.min[1] && coord[1] <= box.max[1] &&
    coord[2] >= box.min[2] && coord[2] <= box.max[2]
  )
}

/**
 * Rig assignment for an explicit voxel coordinate: the deepest box containing it (a nested
 * box wins over its ancestors), ties broken by list order. Returns the box id or null when
 * no box contains the voxel (caller exports those as the default mesh).
 */
export function rigIdForCoord(boxes: RigBox[], coord: Coord): string | null {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const depthOf = (box: RigBox): number => {
    let depth = 0
    let current = box
    const seen = new Set<string>([current.id])
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent || seen.has(parent.id)) break
      seen.add(parent.id)
      depth++
      current = parent
    }
    return depth
  }
  let best: RigBox | null = null
  let bestDepth = -1
  for (const box of boxes) {
    if (!rigBoxContains(box, coord)) continue
    const depth = depthOf(box)
    if (depth > bestDepth) {
      best = box
      bestDepth = depth
    }
  }
  return best?.id ?? null
}

/** Drop position for outline reordering: beside the target row, or nested as its last child. */
export type RigMovePosition = 'before' | 'after' | 'child'

/** All ids in the subtree rooted at `id` (inclusive), following `parentId` links. */
export function rigSubtreeIds(boxes: RigBox[], id: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const b of boxes) {
    if (b.parentId) {
      const list = children.get(b.parentId)
      if (list) list.push(b.id)
      else children.set(b.parentId, [b.id])
    }
  }
  const out = new Set<string>([id])
  const stack = [id]
  while (stack.length > 0) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!out.has(child)) {
        out.add(child)
        stack.push(child)
      }
    }
  }
  return out
}

/**
 * Pure outline move: relocates `dragId` to `targetId` (`null` = end of the root level).
 * `before`/`after` adopt the target's parent and land beside its whole subtree; `child`
 * parents under the target as its last child. Returns the new array (pre-order: a parent
 * immediately precedes its subtree), or null when the move is invalid (unknown ids, or the
 * target sits inside the dragged subtree) — callers treat null as a no-op.
 */
export function moveRigBoxInList(
  boxes: RigBox[],
  dragId: string,
  targetId: string | null,
  position: RigMovePosition,
): RigBox[] | null {
  const drag = boxes.find((b) => b.id === dragId)
  if (!drag) return null
  if (targetId === dragId) return null
  if (targetId === null) {
    const rest = boxes.filter((b) => b.id !== dragId)
    return [...rest, { ...drag, parentId: null }]
  }
  const target = boxes.find((b) => b.id === targetId)
  if (!target) return null
  // No-op when the target sits inside the dragged subtree (would parent a box to itself).
  if (rigSubtreeIds(boxes, dragId).has(target.id)) return null

  const rest = boxes.filter((b) => b.id !== dragId)
  const moved: RigBox = { ...drag, parentId: position === 'child' ? target.id : target.parentId }

  // Anchor at the target's subtree end so the moved box never splits another subtree:
  // `before` lands at the target's start, `after`/`child` after its last descendant.
  const subtree = rigSubtreeIds(rest, target.id)
  let anchor = rest.findIndex((b) => b.id === target.id)
  if (position !== 'before') {
    for (let i = rest.length - 1; i >= 0; i--) {
      if (subtree.has(rest[i].id)) { anchor = i + 1; break }
    }
  }
  return [...rest.slice(0, anchor), moved, ...rest.slice(anchor)]
}
