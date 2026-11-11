import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import { subdivideCell } from '@/engine/grid/subdiv'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { InstancingManager } from './InstancingManager'

const SLOT = { kind: 'base', index: 0 } as const

function raycast(manager: InstancingManager, origin: [number, number, number], dir: [number, number, number]) {
  const rc = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize())
  return rc.intersectObject(manager.pickObject, false)[0]
}

function axisNormal(hit: THREE.Intersection): [number, number, number] {
  const n = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).round()
  return [n.x, n.y, n.z]
}

describe('InstancingManager — AABB picking (construction-plane selection is never confused by chamfer geometry)', () => {
  it('picks a chamfered cell as a full unit cube with a clean ±axis face normal', () => {
    const model: VoxelModel = emptyModel()
    const key = encodeKey(5, 0, 0)
    model.color.set(key, { paletteSlot: SLOT })
    // A resolved ramp — its VISIBLE face is sloped, but the pick must still see the full cube face.
    model.chamfer.set(key, { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'ramp', rotation: 1 } })

    const manager = new InstancingManager()
    manager.sync(model, DEFAULT_PALETTE)

    // The cell occupies [5,6]x[0,1]x[0,1]; ray in along -X hits its +X face at a clean normal.
    const hit = raycast(manager, [10, 0.5, 0.5], [-1, 0, 0])
    expect(hit).toBeDefined()
    expect(manager.cellKeyForPick(hit.instanceId!)).toBe(key)
    expect(axisNormal(hit)).toEqual([1, 0, 0])

    manager.dispose()
  })

  it('every occupied cell (cube or chamfer) gets exactly one pick AABB, mapped back to its key', () => {
    const model: VoxelModel = emptyModel()
    const cubeKey = encodeKey(0, 0, 0)
    const chamferKey = encodeKey(3, 0, 0)
    model.color.set(cubeKey, { paletteSlot: SLOT })
    model.color.set(chamferKey, { paletteSlot: SLOT })
    model.chamfer.set(chamferKey, { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'convex', rotation: 2 } })

    const manager = new InstancingManager()
    manager.sync(model, DEFAULT_PALETTE)

    expect(manager.pickObject.count).toBe(2)
    const picked = new Set([manager.cellKeyForPick(0), manager.cellKeyForPick(1)])
    expect(picked).toEqual(new Set([cubeKey, chamferKey]))

    manager.dispose()
  })

  it('picks the nearest cell along the ray (a chamfer cell in front occludes the cube behind it)', () => {
    const model: VoxelModel = emptyModel()
    const front = encodeKey(6, 0, 0) // closer to the +X ray origin
    const back = encodeKey(4, 0, 0)
    model.color.set(front, { paletteSlot: SLOT })
    model.color.set(back, { paletteSlot: SLOT })
    model.chamfer.set(front, { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'concave', rotation: 0 } })

    const manager = new InstancingManager()
    manager.sync(model, DEFAULT_PALETTE)

    const hit = raycast(manager, [12, 0.5, 0.5], [-1, 0, 0])
    expect(manager.cellKeyForPick(hit.instanceId!)).toBe(front)

    manager.dispose()
  })
})

describe('InstancingManager — subdivided detail', () => {
  it('emits one half-cube pick AABB per live child, keyed to parent + octant', () => {
    const model: VoxelModel = emptyModel()
    const parent = encodeKey(0, 0, 0)
    model.color.set(parent, { paletteSlot: SLOT })
    model.color.set(encodeKey(0, 2, 0), { paletteSlot: SLOT })
    expect(subdivideCell(model, [0, 0, 0])).toBe(true)

    const manager = new InstancingManager()
    manager.sync(model, DEFAULT_PALETTE)

    // 1 full cube + 8 half-cubes, no full-cube box for the subdivided parent.
    expect(manager.pickObject.count).toBe(9)
    // Ray at y=0.25, z=0.25 along -X hits octant (dx=1,dy=0,dz=0) = 1 at x=1.
    const hit = raycast(manager, [10, 0.25, 0.25], [-1, 0, 0])
    expect(hit).toBeDefined()
    expect(manager.cellKeyForPick(hit.instanceId!)).toBe(parent)
    expect(manager.detailIndexForPick(hit.instanceId!)).toBe(1)
    expect(axisNormal(hit)).toEqual([1, 0, 0])

    manager.dispose()
  })

  it('erased holes have no pick box — rays fall through to what is behind', () => {
    const model: VoxelModel = emptyModel()
    const parent = encodeKey(0, 0, 0)
    model.color.set(parent, { paletteSlot: SLOT })
    model.color.set(encodeKey(-1, 0, 0), { paletteSlot: SLOT })
    expect(subdivideCell(model, [0, 0, 0])).toBe(true)
    // Erase the two octants on the ray line (dy=0, dz=0: octants 0 and 1) so it passes through.
    model.subdiv.get(parent)!.children[0] = null
    model.subdiv.get(parent)!.children[1] = null

    const manager = new InstancingManager()
    manager.sync(model, DEFAULT_PALETTE)

    expect(manager.pickObject.count).toBe(1 + 6)
    // Ray through the erased half hits the back cube at x=-1.
    const hit = raycast(manager, [10, 0.25, 0.25], [-1, 0, 0])
    expect(hit).toBeDefined()
    expect(manager.cellKeyForPick(hit.instanceId!)).toBe(encodeKey(-1, 0, 0))
    expect(manager.detailIndexForPick(hit.instanceId!)).toBeNull()

    manager.dispose()
  })
})
