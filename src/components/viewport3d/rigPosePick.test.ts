import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { pickRigBoxId, setRigPosePickGroups } from './rigPosePick'

function taggedBox(id: string, x: number, z: number): THREE.Group {
  const group = new THREE.Group()
  group.userData.pickBoxId = id
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  mesh.position.set(x, 0, z)
  group.add(mesh)
  group.updateMatrixWorld(true)
  return group
}

function centerRay(): THREE.Raycaster {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2(0, 0), camera)
  return ray
}

function offsetRay(): THREE.Raycaster {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2(0.9, 0.9), camera)
  return ray
}

describe('pickRigBoxId', () => {
  beforeEach(() => {
    setRigPosePickGroups(new Map())
  })

  it('returns null with no registered groups', () => {
    expect(pickRigBoxId(centerRay())).toBeNull()
  })

  it('picks the tagged group under the ray', () => {
    setRigPosePickGroups(new Map([['arm', taggedBox('arm', 0, 0)]]))
    expect(pickRigBoxId(centerRay())).toBe('arm')
  })

  it('misses a ray that hits no group', () => {
    setRigPosePickGroups(new Map([['arm', taggedBox('arm', 0, 0)]]))
    expect(pickRigBoxId(offsetRay())).toBeNull()
  })

  it('picks the nearest group when boxes overlap on screen', () => {
    setRigPosePickGroups(
      new Map([
        ['near', taggedBox('near', 0, 0)],
        ['far', taggedBox('far', 0, -5)],
      ]),
    )
    expect(pickRigBoxId(centerRay())).toBe('near')
  })

  it('walks up through untagged nesting to the tagged group', () => {
    const group = new THREE.Group()
    group.userData.pickBoxId = 'leg'
    const inner = new THREE.Group()
    inner.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    group.add(inner)
    group.updateMatrixWorld(true)
    setRigPosePickGroups(new Map([['leg', group]]))
    expect(pickRigBoxId(centerRay())).toBe('leg')
  })

  it('unregisters on clear, so hidden views are never pickable', () => {
    setRigPosePickGroups(new Map([['arm', taggedBox('arm', 0, 0)]]))
    expect(pickRigBoxId(centerRay())).toBe('arm')
    setRigPosePickGroups(new Map())
    expect(pickRigBoxId(centerRay())).toBeNull()
  })
})
