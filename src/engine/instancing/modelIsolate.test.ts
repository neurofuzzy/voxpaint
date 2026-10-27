import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { isolationPlanesForBox, setIsolationClip } from './modelIsolate'
import type { RigBox } from '@/engine/rigging/types'

const box = (min: [number, number, number], max: [number, number, number]): RigBox => ({
  id: 'b', name: 'b', min, max, parentId: null, pivot: null,
})

describe('isolationPlanesForBox', () => {
  it('keeps the box volume and clips everything outside', () => {
    const planes = isolationPlanesForBox(box([1, 2, 3], [4, 5, 6]), 1)
    expect(planes).toHaveLength(6)
    const inside = new THREE.Vector3(2.5, 3.5, 4.5)
    for (const p of planes) expect(p.distanceToPoint(inside)).toBeGreaterThanOrEqual(0)
    // Just outside each face clips.
    expect(planes[0].distanceToPoint(new THREE.Vector3(0.9, 3, 4))).toBeLessThan(0)
    expect(planes[1].distanceToPoint(new THREE.Vector3(5.1, 3, 4))).toBeLessThan(0)
    expect(planes[2].distanceToPoint(new THREE.Vector3(2, 1.9, 4))).toBeLessThan(0)
    expect(planes[5].distanceToPoint(new THREE.Vector3(2, 3, 7.1))).toBeLessThan(0)
  })

  it('scales the Y bounds by voxelScaleY (clipping is world-space)', () => {
    const planes = isolationPlanesForBox(box([0, 1, 0], [0, 1, 0]), 2)
    // Grid y=1 cell spans world y in [2, 4).
    expect(planes[2].distanceToPoint(new THREE.Vector3(0.5, 3.9, 0.5))).toBeGreaterThanOrEqual(0)
    expect(planes[3].distanceToPoint(new THREE.Vector3(0.5, 3.9, 0.5))).toBeGreaterThanOrEqual(0)
    expect(planes[3].distanceToPoint(new THREE.Vector3(0.5, 4.1, 0.5))).toBeLessThan(0)
    expect(planes[2].distanceToPoint(new THREE.Vector3(0.5, 1.9, 0.5))).toBeLessThan(0)
  })
})

describe('setIsolationClip', () => {
  it('assigns once per planes identity (no redundant recompiles)', () => {
    const mat = new THREE.MeshBasicMaterial()
    const planes = isolationPlanesForBox(box([0, 0, 0], [0, 0, 0]), 1)
    const v0 = mat.version
    setIsolationClip([mat], planes)
    expect(mat.clippingPlanes).toBe(planes)
    expect(mat.version).toBeGreaterThan(v0)
    const v1 = mat.version
    setIsolationClip([mat], planes)
    expect(mat.version).toBe(v1)
    setIsolationClip([mat], null)
    expect(mat.clippingPlanes).toBeNull()
  })
})
