import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import type { CellKey, VoxelModel } from '@/engine/grid/types'
import { concaveCornerGeometry, convexCornerGeometry, rampGeometry, unitCubeGeometry } from '@/engine/chamfer/chamferGeometry'
import { emissiveClassFor, resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { chamferInstanceMatrix, cubeInstanceMatrix } from './basis'

export type PoolId = 'cube' | 'ramp' | 'convex' | 'concave'
const POOL_IDS: PoolId[] = ['cube', 'ramp', 'convex', 'concave']

const INITIAL_CAPACITY = 4096

type AnimatedInstance = { index: number; baseColor: THREE.Color; emissiveClass: 2 | 3 }

/**
 * Owns the 4 InstancedMesh pools (cube + 3 chamfer shapes), diffs them against the current
 * model, and exposes instanceId -> CellKey lookups for raycasting (face-click plane picking).
 * Lives outside React — the R3F component just mounts `.group` and calls `sync()`/`tick()`.
 *
 * `MeshLambertMaterial` (lit by `SceneLighting.tsx`'s ambient + 2 directional lights), per-instance
 * colored via `mesh.setColorAt()` — no custom shaders. Base `material.color` MUST stay white
 * (0xffffff): three.js always multiplies `instanceColor` against `material.color` in the shader
 * (gated on `object.instanceColor` being set, NOT on `material.vertexColors`), so any non-white
 * base color tints/distorts every painted color. Blink/pulse animation (palette kinds
 * 'blink'/'pulse', emissiveClass 2/3) is driven from JS in `tick()`, recoloring just those
 * instances via `setColorAt` each frame — not a GPU shader. Only a small subset of cells typically
 * use these palette kinds, so the per-frame JS cost is negligible, and it's far easier to reason
 * about/debug than an `onBeforeCompile` shader patch.
 */
export class InstancingManager {
  readonly group = new THREE.Group()
  private meshes: Record<PoolId, THREE.InstancedMesh>
  private capacities: Record<PoolId, number>
  private indexToCellKey: Record<PoolId, CellKey[]> = { cube: [], ramp: [], convex: [], concave: [] }
  private animatedInstances: Record<PoolId, AnimatedInstance[]> = { cube: [], ramp: [], convex: [], concave: [] }
  private material: THREE.MeshLambertMaterial
  private lastSyncedModel: VoxelModel | null = null
  private scratchColor = new THREE.Color()

  constructor() {
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff })

    const geometries: Record<PoolId, THREE.BufferGeometry> = {
      cube: unitCubeGeometry(),
      ramp: rampGeometry(0),
      convex: convexCornerGeometry(0),
      concave: concaveCornerGeometry(0),
    }

    this.capacities = { cube: INITIAL_CAPACITY, ramp: 256, convex: 256, concave: 256 }
    this.meshes = {} as Record<PoolId, THREE.InstancedMesh>
    for (const id of POOL_IDS) {
      const mesh = new THREE.InstancedMesh(geometries[id], this.material, this.capacities[id])
      mesh.count = 0
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.meshes[id] = mesh
    }
  }

  private ensureCapacity(id: PoolId, needed: number) {
    if (needed <= this.capacities[id]) return
    let newCapacity = this.capacities[id]
    while (newCapacity < needed) newCapacity *= 2
    this.capacities[id] = newCapacity

    const old = this.meshes[id]
    const mesh = new THREE.InstancedMesh(old.geometry, this.material, newCapacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false

    this.group.remove(old)
    old.dispose()
    this.group.add(mesh)
    this.meshes[id] = mesh
  }

  /** Re-syncs all 4 pools against the given model. Full rebuild per spec's sanctioned v1 simplification. */
  sync(model: VoxelModel, palette: PaletteState) {
    if (model === this.lastSyncedModel) return
    this.lastSyncedModel = model

    const byPool: Record<PoolId, CellKey[]> = { cube: [], ramp: [], convex: [], concave: [] }
    for (const key of model.color.keys()) {
      const chamfer = model.chamfer.get(key)
      byPool[chamfer ? chamfer.shapeKind : 'cube'].push(key)
    }

    for (const id of POOL_IDS) {
      const keys = byPool[id]
      this.ensureCapacity(id, keys.length)
      const mesh = this.meshes[id]
      this.indexToCellKey[id] = keys
      const animated: AnimatedInstance[] = []

      const matrix = new THREE.Matrix4()
      const color = new THREE.Color()
      keys.forEach((key, i) => {
        const coord = decodeKey(key)
        const colorCell = model.color.get(key)!
        const chamferCell = model.chamfer.get(key)

        if (chamferCell) {
          chamferInstanceMatrix(coord, chamferCell.planeAxis, chamferCell.planeOrientation, chamferCell.rotation, matrix)
        } else {
          cubeInstanceMatrix(coord, matrix)
        }
        mesh.setMatrixAt(i, matrix)

        const hex = resolveSlotColor(palette, colorCell.paletteSlot)
        color.set(hex)
        mesh.setColorAt(i, color)

        const emissiveClass = emissiveClassFor(colorCell.paletteSlot.kind)
        if (emissiveClass === 2 || emissiveClass === 3) {
          animated.push({ index: i, baseColor: color.clone(), emissiveClass })
        }
      })

      this.animatedInstances[id] = animated
      mesh.count = keys.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  tick(elapsedSeconds: number) {
    for (const id of POOL_IDS) {
      const animated = this.animatedInstances[id]
      if (animated.length === 0) continue
      const mesh = this.meshes[id]
      for (const { index, baseColor, emissiveClass } of animated) {
        const factor =
          emissiveClass === 2
            ? Math.floor(elapsedSeconds * 1.5) % 2 === 0
              ? 1
              : 0.15 // blink: hard on/off square wave
            : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 3)) // pulse: smooth sine
        this.scratchColor.copy(baseColor).multiplyScalar(factor)
        mesh.setColorAt(index, this.scratchColor)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /** Resolves a raycast hit's (mesh, instanceId) back to a grid CellKey, for face-click plane picking. */
  cellKeyForHit(object: THREE.Object3D, instanceId: number): CellKey | null {
    const poolId = (POOL_IDS as string[]).find((id) => this.meshes[id as PoolId] === object) as PoolId | undefined
    if (!poolId) return null
    return this.indexToCellKey[poolId][instanceId] ?? null
  }

  get meshList(): THREE.InstancedMesh[] {
    return POOL_IDS.map((id) => this.meshes[id])
  }

  dispose() {
    for (const id of POOL_IDS) this.meshes[id].dispose()
    this.material.dispose()
  }
}
