import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Axis, Coord } from '@/engine/grid/types'
import type { JointEuler } from './pose'
import { eulerToQuaternion } from './pose'
import type { Pose, RigBox } from './types'
import { mirrorJointName, mirrorPose } from './mirror'

function box(id: string, name: string): RigBox {
  return { id, name, min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot: null }
}

function pose(joints: Record<string, JointEuler>, offsets?: Record<string, Coord>): Pose {
  return offsets ? { id: 'p', name: 'p', joints, offsets } : { id: 'p', name: 'p', joints }
}

function rotMatrix(e: JointEuler): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromQuaternion(eulerToQuaternion(e))
}

function reflector(axis: Axis): THREE.Matrix4 {
  return new THREE.Matrix4().makeScale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1)
}

function expectMatricesClose(a: THREE.Matrix4, b: THREE.Matrix4): void {
  for (let i = 0; i < 16; i++) expect(a.elements[i]).toBeCloseTo(b.elements[i], 10)
}

describe('mirrorJointName', () => {
  it.each([
    ['arm-upper-left', 'arm-upper-right'],
    ['arm-upper-right', 'arm-upper-left'],
    ['leg_l', 'leg_r'],
    ['leg_r', 'leg_l'],
    ['Hand.L', 'Hand.R'],
    ['Hand.R', 'Hand.L'],
    ['left-foot', 'right-foot'],
    ['right-foot', 'left-foot'],
    ['Left Arm', 'Right Arm'],
    ['Right Arm', 'Left Arm'],
    ['left', 'right'],
    ['right', 'left'],
    ['LEFT', 'RIGHT'],
    ['RIGHT', 'LEFT'],
    ['L', 'R'],
    ['R', 'L'],
    ['l', 'r'],
    ['r', 'l'],
    ['Left', 'Right'],
    ['Right', 'Left'],
  ])('swaps the side token in %s', (input, expected) => {
    expect(mirrorJointName(input)).toBe(expected)
  })

  it.each([['spine'], ['chest'], ['shoulder'], ['elbow'], ['lr'], ['armL'], ['upperArm'], ['leg_L2']])(
    'leaves %s unchanged',
    (name) => {
      expect(mirrorJointName(name)).toBe(name)
    },
  )
})

describe('mirrorPose', () => {
  const pairBoxes = [box('l', 'arm_L'), box('r', 'arm_R'), box('c', 'spine')]

  it('mirroring twice returns the original pose (joints AND offsets)', () => {
    const p = pose(
      { l: [0.5, -0.3, 0.2], c: [0.1, 0.2, 0.3] },
      { l: [1, 2, 3], c: [-1, 0.5, 2] },
    )
    const twice = mirrorPose(mirrorPose(p, pairBoxes, 'x'), pairBoxes, 'x')
    expect(twice.joints).toEqual(p.joints)
    expect(twice.offsets).toEqual(p.offsets)
  })

  it.each(['x', 'y', 'z'] as Axis[])('mirrored rotation equals M·R·M for axis %s', (axis) => {
    const boxes = [box('l', 'arm_L'), box('r', 'arm_R')]
    const e: JointEuler = [0.4, -0.25, 0.35]
    const mirrored = mirrorPose(pose({ l: e }), boxes, axis)
    // Sparse swap: only the mirrored right joint is keyed.
    expect(Object.keys(mirrored.joints)).toEqual(['r'])
    const m = reflector(axis)
    const expected = m.clone().multiply(rotMatrix(e)).multiply(m)
    expectMatricesClose(rotMatrix(mirrored.joints['r']), expected)
  })

  it('mirrors a lone keyed joint across the swap (sparse pairing)', () => {
    const out = mirrorPose(pose({ l: [0.5, 0.1, -0.2] }), pairBoxes, 'x')
    expect('l' in out.joints).toBe(false)
    expect(out.joints['r']).toEqual([0.5, -0.1, 0.2])
  })

  it('swaps values when both sides are keyed', () => {
    const out = mirrorPose(pose({ l: [0.5, 0, 0], r: [0, 0.25, 0] }), pairBoxes, 'x')
    expect(out.joints['l']).toEqual([0, -0.25, 0])
    expect(out.joints['r']).toEqual([0.5, 0, 0])
  })

  it('mirrors unpaired joints in place', () => {
    const out = mirrorPose(pose({ c: [0.3, 0.4, 0.5] }), pairBoxes, 'x')
    expect(out.joints).toEqual({ c: [0.3, -0.4, -0.5] })
  })

  it('treats ambiguous duplicate names as unpaired', () => {
    const boxes = [box('a1', 'arm_L'), box('a2', 'arm_L'), box('b', 'arm_R')]
    const src: Record<string, JointEuler> = { a1: [0.5, 0, 0], b: [0, 0.3, 0] }
    const out = mirrorPose(pose(src), boxes, 'x')
    // No swap anywhere: each joint mirrors in place (no -0 noise either).
    expect(out.joints).toEqual({ a1: [0.5, 0, 0], b: [0, -0.3, 0] })
    const twice = mirrorPose(out, boxes, 'x')
    expect(twice.joints).toEqual(src)
  })

  it('mirrors offsets with the axis component negated, following the pairing', () => {
    const out = mirrorPose(pose({ l: [0.5, 0, 0] }, { l: [1, 2, 3] }), pairBoxes, 'x')
    expect(out.offsets).toEqual({ r: [-1, 2, 3] })
    expect('l' in out.offsets!).toBe(false)
  })

  it('keeps offsets absent when the source had none', () => {
    const out = mirrorPose(pose({ l: [0.5, 0, 0] }), pairBoxes, 'x')
    expect(out.offsets).toBeUndefined()
  })
})
