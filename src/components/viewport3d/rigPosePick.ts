import * as THREE from 'three'

/**
 * Tap-to-select registry for the posed rig-box groups (`RigPoseView`).
 *
 * The voxel face-hit underneath a tap resolves through *bind* voxels, but a posed limb
 * on screen may sit far from its bind cells — so taps raycast the rendered box groups
 * first and fall through to the face hit only on a miss. Groups register here on build
 * (and unregister on disposal or while the pose view is hidden, so stale or invisible
 * matrices never win a pick).
 */
const groups = new Map<string, THREE.Group>()

export function setRigPosePickGroups(next: ReadonlyMap<string, THREE.Group>): void {
  groups.clear()
  for (const [id, group] of next) groups.set(id, group)
}

/**
 * Nearest rig-box group id under the raycaster, or null. Walks each hit up to the
 * group carrying `userData.pickBoxId` (`RigPoseView` tags every box group on build).
 */
export function pickRigBoxId(raycaster: THREE.Raycaster): string | null {
  if (groups.size === 0) return null
  const hits = raycaster.intersectObjects([...groups.values()], true)
  for (const hit of hits) {
    let node: THREE.Object3D | null = hit.object
    while (node) {
      const id = (node.userData as { pickBoxId?: unknown }).pickBoxId
      if (typeof id === 'string') return id
      node = node.parent
    }
  }
  return null
}
