import * as THREE from 'three'
import type { Axis, Coord } from '@/engine/grid/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { rigPivotOf, type RigBox } from './types'

/**
 * Ephemeral pose preview for Animate mode (Phase 1 — no keyframes yet): per-joint local
 * rotations that re-matrix posed subtrees each frame. Identity everywhere = the modeled bind
 * pose. Stored as intrinsic XYZ euler radians in `poseSlice` (arrays stay serializable for the
 * day keys persist them); converted to matrices here.
 *
 * Frames: pivots are absolute grid points, so a joint's local matrix `T(pw)·R·T(−pw)` (with
 * the world offset pw = pivot + 0.5 per axis) is already a world-frame rigid transform, and a
 * box's posed matrix chains by plain parent multiplication — the child rides the parent.
 * Everything here speaks grid coordinates (the Y-scale render group applies voxel stretch
 * above), so rotations stay shear-free in matrix space. Note: with voxelScaleY ≠ 1 the render
 * parent's non-uniform scale shears X/Z-rotated subtrees on screen — accepted for preview
 * (the default scale is 1, and export joints are unaffected).
 */

/** Per-joint local rotation, radians, intrinsic XYZ euler. `[0,0,0]` = bind. */
export type JointEuler = [number, number, number]

const IDENTITY_EULER: JointEuler = [0, 0, 0]

function eulerOf(pose: Map<string, JointEuler>, id: string): JointEuler {
  return pose.get(id) ?? IDENTITY_EULER
}

/** Rotation-only part of an euler as a quaternion. */
export function eulerToQuaternion(e: JointEuler): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'))
}

/**
 * Drag composition for the pose gizmo: absolute orientation after rotating `angle` further
 * about the ring's own axis (parent-frame x/y/z). Premultiplying keeps the ring's meaning
 * ("rotate about the axis you grabbed") exact no matter how the joint is already turned.
 */
export function composeAxisAngle(current: JointEuler, axis: Axis, angle: number): JointEuler {
  const delta = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0),
    angle,
  )
  const next = delta.multiply(eulerToQuaternion(current))
  const e = new THREE.Euler().setFromQuaternion(next, 'XYZ')
  return [e.x, e.y, e.z]
}

/**
 * One joint's local matrix: rotate about the pivot's world point (grid + 0.5 per axis, matching
 * the pivot markers). Identity euler returns identity — unposed boxes cost nothing.
 */
export function localJointMatrix(pivot: Coord, e: JointEuler): THREE.Matrix4 {
  const out = new THREE.Matrix4()
  if (e[0] === 0 && e[1] === 0 && e[2] === 0) return out
  const pw = new THREE.Vector3(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5)
  const r = new THREE.Matrix4().makeRotationFromQuaternion(eulerToQuaternion(e))
  const t = new THREE.Matrix4().makeTranslation(pw.x, pw.y, pw.z)
  const tn = new THREE.Matrix4().makeTranslation(-pw.x, -pw.y, -pw.z)
  return out.multiplyMatrices(t, r).multiply(tn)
}

/** Ordered root-first ancestor chain (box first, root last), with the same guards as the
 * outline/links: dangling, self, and cyclic parents stop the walk instead of hanging. */
function ancestorChain(boxes: RigBox[], box: RigBox): RigBox[] {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const chain: RigBox[] = [box]
  const seen = new Set([box.id])
  let parentId = box.parentId
  while (parentId) {
    if (seen.has(parentId)) break
    const parent = byId.get(parentId)
    if (!parent) break
    chain.push(parent)
    seen.add(parentId)
    parentId = parent.parentId
  }
  return chain.reverse()
}

/**
 * A box's parent-chain matrix (ancestors' locals composed root-first, own local excluded):
 * the frame the pose gizmo draws in (gizmo position = this × pivot, orientation = its
 * rotation part) and the prefix of the box's own posed matrix.
 */
export function parentChainMatrix(boxes: RigBox[], pose: Map<string, JointEuler>, box: RigBox): THREE.Matrix4 {
  const chain = ancestorChain(boxes, box)
  const out = new THREE.Matrix4()
  for (let i = 0; i < chain.length - 1; i++) {
    const b = chain[i]
    out.multiply(localJointMatrix(rigPivotOf(b), eulerOf(pose, b.id)))
  }
  return out
}

/** Posed world matrix per box: parent chain × own local. Roots reduce to their local. */
export function composePoseMatrices(boxes: RigBox[], pose: Map<string, JointEuler>): Map<string, THREE.Matrix4> {
  const out = new Map<string, THREE.Matrix4>()
  for (const box of boxes) {
    out.set(
      box.id,
      parentChainMatrix(boxes, pose, box).multiply(localJointMatrix(rigPivotOf(box), eulerOf(pose, box.id))),
    )
  }
  return out
}

/**
 * A box's pivot in world space after posing: the parent chain carries it (a joint's own
 * local rotation is about its own pivot, so it never moves itself — but ancestors carry
 * the whole subtree). This is where pivot markers, joint links, and the pose gizmo live.
 */
export function posedPivotWorld(boxes: RigBox[], pose: Map<string, JointEuler>, box: RigBox): Coord {
  const pivot = rigPivotOf(box)
  const v = new THREE.Vector3(pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5).applyMatrix4(parentChainMatrix(boxes, pose, box))
  return [v.x, v.y, v.z]
}

/**
 * Wire-box geometry for a rig box's 3D outline, in absolute grid coordinates (NOT
 * pivot-relative): the chrome group carries the box's composed pose matrix, which maps
 * absolute→absolute (its pivot translation is inside the matrix), so pivot-relative
 * vertices would subtract the pivot twice and collapse every box toward the origin.
 */
export function buildRigBoxWireGeometry(box: RigBox): { geometry: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  const PAD = 0.03
  const size: [number, number, number] = [
    box.max[0] - box.min[0] + 1 + PAD * 2,
    box.max[1] - box.min[1] + 1 + PAD * 2,
    box.max[2] - box.min[2] + 1 + PAD * 2,
  ]
  const center: [number, number, number] = [
    (box.min[0] + box.max[0] + 1) / 2,
    (box.min[1] + box.max[1] + 1) / 2,
    (box.min[2] + box.max[2] + 1) / 2,
  ]
  const geometry = new THREE.BoxGeometry(...size)
  geometry.translate(center[0], center[1], center[2])
  const edges = new THREE.EdgesGeometry(geometry)
  return { geometry, edges }
}

/**
 * Writes composed pose matrices into live scene-graph groups (the per-frame half of pose
 * preview — see RigPoseView). Groups keep `matrixAutoUpdate = false` and take the matrix
 * verbatim; setting `matrixWorldNeedsUpdate` is what lets three.js propagate it on the next
 * `updateMatrixWorld` pass (without the flag the render keeps showing the stale matrix).
 */
export function applyPoseMatrices(groups: Map<string, THREE.Group>, matrices: Map<string, THREE.Matrix4>): void {
  for (const [id, group] of groups) {
    const m = matrices.get(id)
    if (!m) continue
    group.matrix.copy(m)
    group.matrixWorldNeedsUpdate = true
  }
}

/**
 * Ring radius for a box's pose gizmo: roomy enough to grab around the box without
 * swallowing the viewport on huge selections.
 */
export function gizmoRadiusForBox(box: RigBox): number {
  const dims = [box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1]
  return Math.min(6, Math.max(1.8, 0.6 * Math.max(...dims) + 0.9))
}

/**
 * Screen-space ring hit test for the pose gizmo: for each ring, intersects the click ray
 * with the ring's plane, snaps to the exact nearest point on the circle (center + R along
 * the hit direction — no sampling, so large rings hit as precisely as small ones), projects
 * it through `project` (grid point → screen pixels, null when unprojectable), and returns
 * the nearest ring within `thresholdPx` of (`sx`, `sy`). Measures exactly what the user
 * sees, so a visible ring is always grabbable — immune to raycast/tube subtleties and
 * friendly to touch. Returns null past the threshold (or when nothing projects).
 */
export function nearestRingHit(
  boxes: RigBox[],
  pose: Map<string, JointEuler>,
  box: RigBox,
  rayOrigin: [number, number, number],
  rayDir: [number, number, number],
  project: (p: Coord) => [number, number] | null,
  sx: number,
  sy: number,
  thresholdPx = 14,
): Axis | null {
  const pivot = rigPivotOf(box)
  const center: Coord = [pivot[0] + 0.5, pivot[1] + 0.5, pivot[2] + 0.5]
  const parent = parentChainMatrix(boxes, pose, box)
  const radius = gizmoRadiusForBox(box)
  const v = new THREE.Vector3()
  let best: Axis | null = null
  let bestDistSq = thresholdPx * thresholdPx
  for (const axis of ['x', 'y', 'z'] as Axis[]) {
    const hit = intersectAxisPlane(rayOrigin, rayDir, center, axis)
    if (!hit) continue
    const dx = hit[0] - center[0]
    const dy = hit[1] - center[1]
    const dz = hit[2] - center[2]
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) continue
    const s = radius / len
    v.set(center[0] + dx * s, center[1] + dy * s, center[2] + dz * s)
    v.applyMatrix4(parent)
    const px = project([v.x, v.y, v.z])
    if (!px) continue
    const ex = px[0] - sx
    const ey = px[1] - sy
    const d = ex * ex + ey * ey
    if (d < bestDistSq) {
      bestDistSq = d
      best = axis
    }
  }
  return best
}

/**
 * Trackball projection: nearest point where a grid-space ray meets the sphere around
 * `center` (falling back to the closest approach when it misses, so wide drags keep
 * steering instead of freezing). Null only when degenerate. Returned unnormalized —
 * callers divide by `radius`.
 */
export function projectToTrackball(
  origin: [number, number, number],
  dir: [number, number, number],
  center: Coord,
  radius: number,
): [number, number, number] | null {
  const ox = origin[0] - center[0]
  const oy = origin[1] - center[1]
  const oz = origin[2] - center[2]
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2]
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const disc = b * b - c
  let t = -b
  if (disc >= 0) {
    const hit = -b - Math.sqrt(disc)
    if (hit > 0) t = hit
    else if (t < 0) t = 0
  } else if (t < 0) {
    t = 0
  }
  const px = ox + dir[0] * t
  const py = oy + dir[1] * t
  const pz = oz + dir[2] * t
  const len = Math.hypot(px, py, pz)
  if (len < 1e-6) return null
  return [px / len, py / len, pz / len]
}

/**
 * Trackball drag composition: absolute orientation after sweeping from unit vector `v0`
 * to `v1` (grid space, relative to the joint center). The sweep is conjugated through the
 * parent chain's world rotation, so dragging means the same thing on screen no matter how
 * ancestors are posed — exactly what the gizmo's drawn orientation promises.
 */
export function trackballEuler(
  current: JointEuler,
  parentQuat: THREE.Quaternion,
  v0: [number, number, number],
  v1: [number, number, number],
): JointEuler {
  const drag = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(v0[0], v0[1], v0[2]),
    new THREE.Vector3(v1[0], v1[1], v1[2]),
  )
  const next = parentQuat.clone().invert().multiply(drag).multiply(parentQuat).multiply(eulerToQuaternion(current))
  const e = new THREE.Euler().setFromQuaternion(next, 'XYZ')
  return [e.x, e.y, e.z]
}

/**
 * Signed angle of grid point `p` around `axis` through `center`, in (−π, π] — the gizmo
 * drag's raw reading. Increasing angle is right-hand-rule positive about the +axis, matching
 * `setFromAxisAngle`, so (current − grab) feeds `composeAxisAngle` directly.
 */
export function angleAroundAxis(p: Coord, center: Coord, axis: Axis): number {
  const i = axisIndex(axis)
  const a = (i + 1) % 3
  const b = (i + 2) % 3
  // Cyclic (not sequential) successor order keeps the right-hand sense per axis:
  // x: (y,z), y: (z,x), z: (x,y) — atan2(second, first).
  const d0 = p[a] - center[a]
  const d1 = p[b] - center[b]
  return Math.atan2(d1, d0)
}

/**
 * Intersects a grid-space ray with the plane perpendicular to `axis` through `point`
 * (the pose gizmo's drag plane — callers convert the world ray by unscaling Y). Null when
 * the ray runs parallel, in which case the drag holds its last angle.
 */
export function intersectAxisPlane(
  origin: [number, number, number],
  dir: [number, number, number],
  point: Coord,
  axis: Axis,
): Coord | null {
  const i = axisIndex(axis)
  if (Math.abs(dir[i]) < 1e-9) return null
  const t = (point[i] - origin[i]) / dir[i]
  if (!Number.isFinite(t)) return null
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t]
}
