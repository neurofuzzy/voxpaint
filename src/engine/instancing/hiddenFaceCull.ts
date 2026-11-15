import * as THREE from 'three'
import { encodeKey } from '@/engine/grid/GridStore'
import { childIndex } from '@/engine/grid/cellBox'
import type { CellKey, VoxelModel } from '@/engine/grid/types'
import { materialClassFor, resolveSlotColor, type MaterialClass } from '@/engine/palette/palette'
import type { PaletteSlotRef, PaletteState } from '@/engine/palette/types'

/**
 * Hidden-face cull at half-voxel resolution — the pass that removes the interior faces exact
 * face matching can't: where a subdivided voxel meets a whole voxel (or a differently split one),
 * the two sides of the interface are differently sized quads, so neither the shell pass's
 * vertex-triple match nor the CSG path's cross-group quad match ever pairs them, and both sides
 * survive inside the solid (dark in the AO bake, wasted atlas space and triangles, visible
 * through glass).
 *
 * Instead of matching, it asks the volume: an axis-aligned triangle on a half-voxel plane is
 * hidden when every half-voxel cell its area touches on the outward side is solid and occludes
 * it under the same rules the exact culls use:
 * - opaque occludes opaque (any class/colour); glass occludes nothing opaque (the solid face must
 *   stay visible through it); anything occludes a glass face (glass is the side dropped);
 * - `sameGroupOnly` (the no-cull export mode) only lets the same (materialClass, colorKey) occlude;
 * - the occupant must belong to the same animation/rig node, or the interface is real.
 * Resolved bevels (whole or detail) never occlude: they don't fill their box.
 */

export type HalfOccupant = { materialClass: MaterialClass; colorKey: number; node: string }

/** Occupant of the half-voxel cube at half coords (hx,hy,hz) — world [h/2, h/2 + 0.5) — or null. */
export type HalfOccupancy = (hx: number, hy: number, hz: number) => HalfOccupant | null

/** Builds the half-voxel occupancy lookup for a model. `nodeOf` names a cell's animation/rig node. */
export function halfOccupancy(
  model: VoxelModel,
  palette: PaletteState,
  nodeOf: (key: CellKey) => string = () => '',
): HalfOccupancy {
  const color = new THREE.Color()
  const bySlot = new Map<string, { materialClass: MaterialClass; colorKey: number }>()
  const slotInfo = (slot: PaletteSlotRef) => {
    const k = `${slot.kind}:${slot.index}`
    let info = bySlot.get(k)
    if (!info) {
      info = { materialClass: materialClassFor(slot.kind), colorKey: color.set(resolveSlotColor(palette, slot)).getHex() }
      bySlot.set(k, info)
    }
    return info
  }
  return (hx, hy, hz) => {
    const cx = Math.floor(hx / 2)
    const cy = Math.floor(hy / 2)
    const cz = Math.floor(hz / 2)
    const key = encodeKey(cx, cy, cz)
    const sub = model.subdiv.get(key)
    if (sub) {
      const child = sub.children[childIndex(sub.split, [hx - cx * 2, hy - cy * 2, hz - cz * 2])]
      if (!child || child.chamfer?.resolvedTo) return null
      return { ...slotInfo(child.slot), node: nodeOf(key) }
    }
    const c = model.color.get(key)
    if (!c || model.chamfer.get(key)?.resolvedTo) return null
    return { ...slotInfo(c.paletteSlot), node: nodeOf(key) }
  }
}

const EPS = 1e-6

/** Area of a 2D triangle clipped to an axis-aligned square (Sutherland–Hodgman). */
function clippedArea(tri: Array<[number, number]>, x0: number, y0: number, x1: number, y1: number): number {
  let poly = tri
  const clip = (inside: (p: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => {
    const out: Array<[number, number]> = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const ia = inside(a)
      const ib = inside(b)
      if (ia) out.push(a)
      if (ia !== ib) out.push(cut(a, b))
    }
    poly = out
  }
  const lerpX = (x: number) => (a: [number, number], b: [number, number]): [number, number] => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])]
  const lerpY = (y: number) => (a: [number, number], b: [number, number]): [number, number] => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y]
  clip((p) => p[0] >= x0, lerpX(x0))
  if (poly.length) clip((p) => p[0] <= x1, lerpX(x1))
  if (poly.length) clip((p) => p[1] >= y0, lerpY(y0))
  if (poly.length) clip((p) => p[1] <= y1, lerpY(y1))
  let area = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area) / 2
}

/** Whether `occupant` hides a face of `self` (see the module rules). */
function occludes(self: HalfOccupant, o: HalfOccupant | null, sameGroupOnly: boolean): boolean {
  if (!o || o.node !== self.node) return false
  if (sameGroupOnly) {
    // Union-equivalent mode: only one export mesh's own interior cancels — except a glass face,
    // which still drops against whatever it backs onto (it would z-fight the face behind it).
    return self.materialClass === 'glass' || (o.materialClass === self.materialClass && o.colorKey === self.colorKey)
  }
  return self.materialClass === 'glass' || o.materialClass !== 'glass'
}

/**
 * True when the triangle (outward `normal`) lies on a half-voxel plane with every half-voxel cell
 * its area covers on the outward side occluding it. Non-axis-aligned triangles, triangles off the
 * half-voxel lattice, and any partly exposed triangle are never hidden.
 */
export function triangleHidden(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  normal: THREE.Vector3,
  self: HalfOccupant,
  occ: HalfOccupancy,
  sameGroupOnly: boolean,
): boolean {
  const n = [normal.x, normal.y, normal.z]
  const axis = n.findIndex((v) => Math.abs(v) > 0.999)
  if (axis === -1) return false
  const pa = [a.x, a.y, a.z]
  const pb = [b.x, b.y, b.z]
  const pc = [c.x, c.y, c.z]
  const plane = pa[axis]
  if (Math.abs(pb[axis] - plane) > EPS || Math.abs(pc[axis] - plane) > EPS) return false
  const h2 = plane * 2
  if (Math.abs(h2 - Math.round(h2)) > EPS) return false
  const outward = n[axis] > 0 ? Math.round(h2) : Math.round(h2) - 1
  const [t1, t2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
  const tri: Array<[number, number]> = [[pa[t1], pa[t2]], [pb[t1], pb[t2]], [pc[t1], pc[t2]]]
  const lo1 = Math.min(tri[0][0], tri[1][0], tri[2][0])
  const hi1 = Math.max(tri[0][0], tri[1][0], tri[2][0])
  const lo2 = Math.min(tri[0][1], tri[1][1], tri[2][1])
  const hi2 = Math.max(tri[0][1], tri[1][1], tri[2][1])
  let covered = false
  const h = [0, 0, 0]
  h[axis] = outward
  for (let i = Math.floor(lo1 * 2 + EPS); i < Math.ceil(hi1 * 2 - EPS); i++) {
    for (let j = Math.floor(lo2 * 2 + EPS); j < Math.ceil(hi2 * 2 - EPS); j++) {
      if (clippedArea(tri, i / 2, j / 2, (i + 1) / 2, (j + 1) / 2) <= EPS) continue
      h[t1] = i
      h[t2] = j
      if (!occludes(self, occ(h[0], h[1], h[2]), sameGroupOnly)) return false
      covered = true
    }
  }
  return covered
}

/** Drops the hidden triangles of one non-indexed position+normal geometry (all of `self`). */
export function cullHiddenTriangles(geometry: THREE.BufferGeometry, self: HalfOccupant, occ: HalfOccupancy, sameGroupOnly: boolean): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const nrm = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (!pos || !nrm) return geometry
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const positions: number[] = []
  const normals: number[] = []
  let dropped = 0
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, t * 3)
    b.fromBufferAttribute(pos, t * 3 + 1)
    c.fromBufferAttribute(pos, t * 3 + 2)
    n.fromBufferAttribute(nrm, t * 3).normalize()
    if (triangleHidden(a, b, c, n, self, occ, sameGroupOnly)) {
      dropped++
      continue
    }
    for (let k = 0; k < 3; k++) {
      positions.push(pos.getX(t * 3 + k), pos.getY(t * 3 + k), pos.getZ(t * 3 + k))
      normals.push(nrm.getX(t * 3 + k), nrm.getY(t * 3 + k), nrm.getZ(t * 3 + k))
    }
  }
  if (dropped === 0) return geometry
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return out
}
