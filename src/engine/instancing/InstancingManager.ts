import * as THREE from 'three'
import { decodeKey } from '@/engine/grid/GridStore'
import type { CellKey, ChamferCell, VoxelModel } from '@/engine/grid/types'
import { concaveCornerGeometry, convexCornerGeometry, mirrorVGeometry, rampGeometry, unitCubeGeometry } from '@/engine/chamfer/chamferGeometry'
import { emissiveClassFor, resolveSlotColor } from '@/engine/palette/palette'
import type { PaletteState } from '@/engine/palette/types'
import { chamferBasisIsReflected, chamferInstanceMatrix, cubeInstanceMatrix } from './basis'

// Chamfer shapes split into a plain and a v-mirrored (`…M`) pool: reflected-basis planes (+Z/+X/-Y)
// use the mirrored geometry so every rendered instance stays a proper rotation and lights correctly.
// See basis.ts's chamferBasisIsReflected and chamferGeometry.ts's mirrorVGeometry.
export type PoolId = 'cube' | 'ramp' | 'convex' | 'concave' | 'rampM' | 'convexM' | 'concaveM'
const POOL_IDS: PoolId[] = ['cube', 'ramp', 'convex', 'concave', 'rampM', 'convexM', 'concaveM']

/** The pool a color cell belongs to, accounting for its baked shape and plane handedness. */
function poolIdFor(chamfer: ChamferCell | undefined): PoolId {
  if (!chamfer?.resolvedTo) return 'cube'
  const kind = chamfer.resolvedTo.shapeKind
  return chamferBasisIsReflected(chamfer.planeAxis, chamfer.planeOrientation) ? (`${kind}M` as PoolId) : kind
}

const emptyPools = <T>(): Record<PoolId, T[]> =>
  Object.fromEntries(POOL_IDS.map((id) => [id, [] as T[]])) as unknown as Record<PoolId, T[]>

const INITIAL_CAPACITY = 4096

type AnimatedInstance = { index: number; baseColor: THREE.Color; emissiveClass: 2 | 3 }
type InstanceRef = { poolId: PoolId; index: number }
type HoverTarget = InstanceRef & { cellKey: CellKey }

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
  private animatedInstances: Record<PoolId, AnimatedInstance[]> = emptyPools<AnimatedInstance>()
  private baseColors: Record<PoolId, THREE.Color[]> = emptyPools<THREE.Color>()
  private cellKeyToInstance = new Map<CellKey, InstanceRef>()
  private hoverTarget: HoverTarget | null = null
  private material: THREE.MeshLambertMaterial
  private lastSyncedModel: VoxelModel | null = null
  private scratchColor = new THREE.Color()

  // Picking runs against full-cell AABBs (unit cubes), NOT the visible chamfer meshes: clicking a
  // sloped chamfer face must still resolve to that cell and a clean axis-aligned face normal, so the
  // construction-plane pick is never confused by the bevel geometry. This invisible InstancedMesh
  // holds one axis-aligned unit cube per occupied cell; raycasting hits it instead of `meshes`.
  private pickGeometry = unitCubeGeometry()
  private pickMaterial = new THREE.MeshBasicMaterial()
  private pickMesh: THREE.InstancedMesh
  private pickCapacity = INITIAL_CAPACITY
  private pickIndexToCellKey: CellKey[] = []

  constructor() {
    // DoubleSide: the chamfer instance basis (makeBasis of worldU/worldV/outward) is a reflection
    // on the x- and z-planes (negative determinant), which flips triangle winding in screen space.
    // Rendering both sides keeps the (correctly outward-wound) chamfer faces visible on every plane;
    // three flips the normal for the viewed backface so Lambert lighting stays correct.
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })

    const ramp = rampGeometry(0)
    const convex = convexCornerGeometry(0)
    const concave = concaveCornerGeometry(0)
    const geometries: Record<PoolId, THREE.BufferGeometry> = {
      cube: unitCubeGeometry(),
      ramp,
      convex,
      concave,
      rampM: mirrorVGeometry(ramp),
      convexM: mirrorVGeometry(convex),
      concaveM: mirrorVGeometry(concave),
    }

    this.capacities = { cube: INITIAL_CAPACITY, ramp: 256, convex: 256, concave: 256, rampM: 256, convexM: 256, concaveM: 256 }
    this.meshes = {} as Record<PoolId, THREE.InstancedMesh>
    for (const id of POOL_IDS) {
      const mesh = new THREE.InstancedMesh(geometries[id], this.material, this.capacities[id])
      mesh.count = 0
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.meshes[id] = mesh
    }

    this.pickMesh = this.makePickMesh(this.pickCapacity)
    this.group.add(this.pickMesh)
  }

  /** Invisible unit-cube instanced mesh used only for AABB raycasting (never rendered). */
  private makePickMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.pickGeometry, this.pickMaterial, capacity)
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.visible = false // not rendered; still raycastable when passed explicitly to the Raycaster
    return mesh
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

  private ensurePickCapacity(needed: number) {
    if (needed <= this.pickCapacity) return
    while (this.pickCapacity < needed) this.pickCapacity *= 2
    const old = this.pickMesh
    this.pickMesh = this.makePickMesh(this.pickCapacity)
    this.group.remove(old)
    old.dispose()
    this.group.add(this.pickMesh)
  }

  /** Rebuilds the AABB pick mesh: one axis-aligned unit cube per occupied cell (regardless of its
   * visible shape), so raycasting always yields the cell and a clean ±axis face normal. */
  private syncPickMesh(model: VoxelModel) {
    this.ensurePickCapacity(model.color.size)
    const keys: CellKey[] = []
    const matrix = new THREE.Matrix4()
    for (const key of model.color.keys()) {
      cubeInstanceMatrix(decodeKey(key), matrix)
      this.pickMesh.setMatrixAt(keys.length, matrix)
      keys.push(key)
    }
    this.pickIndexToCellKey = keys
    this.pickMesh.count = keys.length
    this.pickMesh.instanceMatrix.needsUpdate = true
  }

  /** Re-syncs all 4 pools against the given model. Full rebuild per spec's sanctioned v1 simplification. */
  sync(model: VoxelModel, palette: PaletteState) {
    if (model === this.lastSyncedModel) return
    this.lastSyncedModel = model

    const byPool: Record<PoolId, CellKey[]> = emptyPools<CellKey>()
    for (const key of model.color.keys()) {
      // Unresolved chamfer cells (resolvedTo: null) fall through to the 'cube' pool until they resolve.
      byPool[poolIdFor(model.chamfer.get(key))].push(key)
    }

    this.cellKeyToInstance.clear()

    for (const id of POOL_IDS) {
      const keys = byPool[id]
      this.ensureCapacity(id, keys.length)
      const mesh = this.meshes[id]
      const animated: AnimatedInstance[] = []
      const baseColors: THREE.Color[] = []

      const matrix = new THREE.Matrix4()
      keys.forEach((key, i) => {
        const coord = decodeKey(key)
        const colorCell = model.color.get(key)!
        const chamferCell = model.chamfer.get(key)

        if (chamferCell?.resolvedTo) {
          chamferInstanceMatrix(coord, chamferCell.planeAxis, chamferCell.planeOrientation, chamferCell.resolvedTo.rotation, matrix)
        } else {
          cubeInstanceMatrix(coord, matrix)
        }
        mesh.setMatrixAt(i, matrix)

        const hex = resolveSlotColor(palette, colorCell.paletteSlot)
        const color = new THREE.Color(hex)
        baseColors.push(color)
        mesh.setColorAt(i, color)
        this.cellKeyToInstance.set(key, { poolId: id, index: i })

        const emissiveClass = emissiveClassFor(colorCell.paletteSlot.kind)
        if (emissiveClass === 2 || emissiveClass === 3) {
          animated.push({ index: i, baseColor: color, emissiveClass })
        }
      })

      this.animatedInstances[id] = animated
      this.baseColors[id] = baseColors
      mesh.count = keys.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }

    this.syncPickMesh(model)

    // Model rebuild may have moved/removed the hovered cell's instance index — re-resolve rather
    // than risk pointing at a stale/out-of-range slot.
    if (this.hoverTarget) {
      const resolved = this.cellKeyToInstance.get(this.hoverTarget.cellKey)
      this.hoverTarget = resolved ? { cellKey: this.hoverTarget.cellKey, ...resolved } : null
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

    // Hover highlight: pulses the hovered instance between slightly darker and slightly lighter
    // than its own painted color. Applied after (so it wins over) the emissive animation above if
    // the hovered cell happens to also be a blink/pulse cell.
    if (this.hoverTarget) {
      const { poolId, index } = this.hoverTarget
      const base = this.baseColors[poolId][index]
      if (base) {
        const factor = 1 + 0.22 * Math.sin(elapsedSeconds * 6)
        this.scratchColor.copy(base).multiplyScalar(factor)
        const mesh = this.meshes[poolId]
        mesh.setColorAt(index, this.scratchColor)
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
  }

  /** Sets (or clears, on `null`) the cell that should render the hover blink. Restores the
   * previously-hovered instance to its resting color first — for a non-animated cell this is the
   * only thing that will ever restore it (tick() only touches animated + hovered instances). */
  setHoveredCell(key: CellKey | null) {
    const resolved = key ? this.cellKeyToInstance.get(key) : undefined
    const next: HoverTarget | null = resolved ? { cellKey: key!, ...resolved } : null

    if (this.hoverTarget && (!next || next.poolId !== this.hoverTarget.poolId || next.index !== this.hoverTarget.index)) {
      const { poolId, index } = this.hoverTarget
      const base = this.baseColors[poolId][index]
      if (base) {
        const mesh = this.meshes[poolId]
        mesh.setColorAt(index, base)
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }

    this.hoverTarget = next
  }

  /** Toggle wireframe on the shared render material (all 7 pools; the pick material is separate). */
  setWireframe(v: boolean) {
    this.material.wireframe = v
  }

  /** Show/hide the visible render pools without touching the invisible pick mesh — so
   * construction-plane picking keeps working while the optimized mesh is shown instead. */
  setRenderVisible(v: boolean) {
    for (const id of POOL_IDS) this.meshes[id].visible = v
  }

  /** The invisible AABB mesh to raycast for construction-plane picking. Pass it to
   * `Raycaster.intersectObject` — it resolves hits via `cellKeyForPick` and yields clean box normals. */
  get pickObject(): THREE.InstancedMesh {
    return this.pickMesh
  }

  /** Resolves a pick-mesh raycast hit's instanceId back to a grid CellKey. */
  cellKeyForPick(instanceId: number): CellKey | null {
    return this.pickIndexToCellKey[instanceId] ?? null
  }

  dispose() {
    for (const id of POOL_IDS) this.meshes[id].dispose()
    this.material.dispose()
    this.pickMesh.dispose()
    this.pickGeometry.dispose()
    this.pickMaterial.dispose()
  }
}
