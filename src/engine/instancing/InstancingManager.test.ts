import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
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
