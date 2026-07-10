import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import type { CellKey, VoxelModel } from '@/engine/grid/types'
import { concaveCornerGeometry, convexCornerGeometry, rampGeometry, unitCubeGeometry } from '@/engine/chamfer/chamferGeometry'
import { emissiveClassFor, resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { chamferInstanceMatrix, cubeInstanceMatrix } from './basis'
import { createSharedVoxelMaterial } from './sharedMaterial'

export type PoolId = 'cube' | 'ramp' | 'convex' | 'concave'
const POOL_IDS: PoolId[] = ['cube', 'ramp', 'convex', 'concave']

const INITIAL_CAPACITY = 4096

/**
 * Owns the 4 InstancedMesh pools (cube + 3 chamfer shapes), diffs them against the current
 * model, and exposes instanceId -> CellKey lookups for raycasting (face-click plane picking).
 * Lives outside React — the R3F component just mounts `.group` and calls `sync()`/`tick()`.
 */
export class InstancingManager {
  readonly group = new THREE.Group()
  private meshes: Record<PoolId, THREE.InstancedMesh>
  private capacities: Record<PoolId, number>
  private indexToCellKey: Record<PoolId, CellKey[]> = { cube: [], ramp: [], convex: [], concave: [] }
  private material: THREE.MeshStandardMaterial
  private uniforms: { uClock: { value: number } }
  private lastSyncedModel: VoxelModel | null = null

  constructor() {
    const { material, uniforms } = createSharedVoxelMaterial()
    this.material = material
    this.uniforms = uniforms

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
      this.attachEmissiveAttributes(mesh)
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.meshes[id] = mesh
    }
  }

  private attachEmissiveAttributes(mesh: THREE.InstancedMesh) {
    const capacity = mesh.instanceMatrix.count
    mesh.geometry.setAttribute(
      'instanceEmissiveClass',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    )
    mesh.geometry.setAttribute(
      'instanceEmissiveColor',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    )
  }

  private ensureCapacity(id: PoolId, needed: number) {
    if (needed <= this.capacities[id]) return
    let newCapacity = this.capacities[id]
    while (newCapacity < needed) newCapacity *= 2
    this.capacities[id] = newCapacity

    const old = this.meshes[id]
    const mesh = new THREE.InstancedMesh(old.geometry, this.material, newCapacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.attachEmissiveAttributes(mesh)
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
      const emissiveClassAttr = mesh.geometry.getAttribute('instanceEmissiveClass') as THREE.InstancedBufferAttribute
      const emissiveColorAttr = mesh.geometry.getAttribute('instanceEmissiveColor') as THREE.InstancedBufferAttribute
      this.indexToCellKey[id] = keys

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
        emissiveClassAttr.setX(i, emissiveClass)
        if (emissiveClass > 0) {
          emissiveColorAttr.setXYZ(i, color.r, color.g, color.b)
        } else {
          emissiveColorAttr.setXYZ(i, 0, 0, 0)
        }
      })

      mesh.count = keys.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      emissiveClassAttr.needsUpdate = true
      emissiveColorAttr.needsUpdate = true
    }
  }

  tick(elapsedSeconds: number) {
    this.uniforms.uClock.value = elapsedSeconds
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
