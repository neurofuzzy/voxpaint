import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Coord } from '@/engine/grid/types'
import type { RigBox } from './types'
import type { JointEuler } from './pose'
import { angleAroundAxis, applyPoseMatrices, buildRigBoxWireGeometry, composeAxisAngle, composePoseMatrices, eulerToQuaternion, gizmoRadiusForBox, intersectAxisPlane, localJointMatrix, nearestRingHit, parentChainMatrix, posedPivotWorld, projectToTrackball, trackballEuler } from './pose'

function box(id: string, parentId: string | null = null, pivot: Coord | null = null): RigBox {
  return { id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId, pivot }
}

function apply(m: THREE.Matrix4, p: Coord): [number, number, number] {
  const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m)
  return [v.x, v.y, v.z]
}

function closeTo(a: [number, number, number], b: [number, number, number]) {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 10)
}

describe('localJointMatrix', () => {
  it('is identity for the bind pose', () => {
    const m = localJointMatrix([1, 1, 1], [0, 0, 0])
    closeTo(apply(m, [4, -2, 9]), [4, -2, 9])
  })

  it('rotates about the pivot world point, not the origin', () => {
    // Pivot grid [0,0,0] → world (0.5,0.5,0.5); +90° about z sends +x to +y around it.
    const m = localJointMatrix([0, 0, 0], [0, 0, Math.PI / 2])
    closeTo(apply(m, [1.5, 0.5, 0.5]), [0.5, 1.5, 0.5])
    // The pivot itself never moves.
    closeTo(apply(m, [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5])
  })
})

describe('composePoseMatrices', () => {
  it('leaves unposed boxes identical', () => {
    const boxes = [box('a'), box('b', 'a')]
    const out = composePoseMatrices(boxes, new Map())
    closeTo(apply(out.get('a')!, [3, 3, 3]), [3, 3, 3])
    closeTo(apply(out.get('b')!, [3, 3, 3]), [3, 3, 3])
  })

  it('chains the child under a rotated parent', () => {
    // Parent pivot [0,0,0] (world .5,.5,.5), +90° about z; child unposed.
    const boxes = [box('p', null, [0, 0, 0]), box('c', 'p', [0, 0, 0])]
    const out = composePoseMatrices(boxes, new Map([['p', [0, 0, Math.PI / 2]]]))
    // A point one unit +x of the parent pivot swings to +y.
    closeTo(apply(out.get('p')!, [1.5, 0.5, 0.5]), [0.5, 1.5, 0.5])
    // The child rides the parent even with no local rotation of its own.
    closeTo(apply(out.get('c')!, [1.5, 0.5, 0.5]), [0.5, 1.5, 0.5])
  })

  it('composes own local rotation after the parent chain', () => {
    const boxes = [box('p', null, [0, 0, 0]), box('c', 'p', [0, 0, 0])]
    const pose = new Map([
      ['p', [0, 0, Math.PI / 2] as [number, number, number]],
      ['c', [0, 0, Math.PI / 2] as [number, number, number]],
    ])
    const out = composePoseMatrices(boxes, pose)
    // +x → +y (parent) → −x (child local): net 180°.
    closeTo(apply(out.get('c')!, [1.5, 0.5, 0.5]), [-0.5, 0.5, 0.5])
  })

  it('survives dangling, self, and cyclic parents', () => {
    const boxes = [box('d', 'missing'), box('s', 's'), box('x', 'y'), box('y', 'x')]
    const out = composePoseMatrices(boxes, new Map([['x', [0, 0, Math.PI / 2]]]))
    expect(out.size).toBe(4)
    closeTo(apply(out.get('d')!, [1, 2, 3]), [1, 2, 3])
  })
})

describe('parentChainMatrix', () => {
  it('excludes the box’s own local rotation', () => {
    const boxes = [box('p', null, [0, 0, 0]), box('c', 'p', [0, 0, 0])]
    const pose = new Map([
      ['p', [0, 0, Math.PI / 2] as [number, number, number]],
      ['c', [0, Math.PI / 2, 0] as [number, number, number]],
    ])
    const parent = parentChainMatrix(boxes, pose, boxes[1])
    // Only the parent's z-rotation applies.
    closeTo(apply(parent, [1.5, 0.5, 0.5]), [0.5, 1.5, 0.5])
  })
})

describe('composeAxisAngle', () => {
  it('rotates identity to a single-axis euler', () => {
    const e = composeAxisAngle([0, 0, 0], 'x', Math.PI / 2)
    expect(e[0]).toBeCloseTo(Math.PI / 2, 10)
    expect(e[1]).toBeCloseTo(0, 10)
    expect(e[2]).toBeCloseTo(0, 10)
    // And the resulting orientation turns +y toward +z (right-hand about +x).
    const v = new THREE.Vector3(0, 1, 0).applyQuaternion(eulerToQuaternion(e))
    expect(v.x).toBeCloseTo(0, 10)
    expect(v.y).toBeCloseTo(0, 10)
    expect(v.z).toBeCloseTo(1, 10)
  })

  it('accumulates repeated drags about the same ring', () => {
    const once = composeAxisAngle([0, 0, 0], 'z', Math.PI / 2)
    const twice = composeAxisAngle(once, 'z', Math.PI / 2)
    const v = new THREE.Vector3(1, 0, 0).applyQuaternion(eulerToQuaternion(twice))
    expect(v.x).toBeCloseTo(-1, 10)
    expect(v.y).toBeCloseTo(0, 10)
  })
})

describe('gizmoRadiusForBox', () => {
  it('clamps to a grabbable range', () => {
    const tiny: RigBox = { id: 'tiny', name: 'tiny', min: [0, 0, 0], max: [0, 0, 0], parentId: null, pivot: null }
    expect(gizmoRadiusForBox(tiny)).toBe(1.8)
    const mid = gizmoRadiusForBox(box('mid', null, [0, 0, 0]))
    expect(mid).toBeGreaterThan(1.8)
    expect(mid).toBeLessThan(6)
    const huge = { ...box('huge', null, [0, 0, 0]), max: [63, 63, 63] as Coord }
    expect(gizmoRadiusForBox(huge)).toBe(6)
  })
})

describe('projectToTrackball', () => {
  it('hits the sphere surface', () => {
    const hit = projectToTrackball([5, 0, 0], [-1, 0, 0], [0, 0, 0], 2)
    expect(hit).not.toBeNull()
    closeTo(hit!, [1, 0, 0])
  })

  it('falls back to the closest approach on a miss', () => {
    const hit = projectToTrackball([5, 5, 0], [-1, 0, 0], [0, 0, 0], 2)
    expect(hit).not.toBeNull()
    // Closest approach is (0,5,0) → normalized (0,1,0).
    closeTo(hit!, [0, 1, 0])
  })
})

describe('applyPoseMatrices', () => {
  it('moves the rendered world point through a plain scene graph', () => {
    const boxes = [box('arm', null, [0, 0, 0])]
    const matrices = composePoseMatrices(boxes, new Map([['arm', [0, 0, Math.PI / 2]]]))
    const root = new THREE.Group()
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    root.add(group)
    root.updateMatrixWorld(true)
    const groups = new Map([['arm', group]])
    applyPoseMatrices(groups, matrices)
    root.updateMatrixWorld(true)
    // Voxel one unit +x of the pivot world (0.5,0.5,0.5) swings to +y.
    const v = new THREE.Vector3(1.5, 0.5, 0.5).applyMatrix4(group.matrixWorld)
    closeTo([v.x, v.y, v.z], [0.5, 1.5, 0.5])
  })

  it('flags matrices for propagation', () => {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    group.matrixWorldNeedsUpdate = false
    applyPoseMatrices(new Map([['a', group]]), new Map([['a', new THREE.Matrix4()]]))
    expect(group.matrixWorldNeedsUpdate).toBe(true)
  })
})

describe('trackballEuler', () => {
  it('is identity for a null sweep', () => {
    const e = trackballEuler([0.3, 0, 0], new THREE.Quaternion(), [1, 0, 0], [1, 0, 0])
    expect(e[0]).toBeCloseTo(0.3, 10)
    expect(e[1]).toBeCloseTo(0, 10)
    expect(e[2]).toBeCloseTo(0, 10)
  })

  it('rotates x toward y with an identity parent', () => {
    const e = trackballEuler([0, 0, 0], new THREE.Quaternion(), [1, 0, 0], [0, 1, 0])
    const v = new THREE.Vector3(1, 0, 0).applyQuaternion(eulerToQuaternion(e))
    expect(v.x).toBeCloseTo(0, 10)
    expect(v.y).toBeCloseTo(1, 10)
    expect(v.z).toBeCloseTo(0, 10)
  })
})

describe('buildRigBoxWireGeometry', () => {
  it('builds in absolute grid coordinates, not pivot-relative', () => {
    // A box far from the origin must stay there: pivot-relative vertices would subtract
    // the pivot twice against the absolute pose matrix and collapse it to the origin.
    const b: RigBox = { ...box('b', null, null), min: [10, 0, 0], max: [12, 2, 2] }
    const { geometry } = buildRigBoxWireGeometry(b)
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox!
    // Precision 6: PAD (0.03) isn't exact in binary, so box-arithmetic lands ~1e-7 off.
    for (const [got, want] of [[bb.min.x, 10 - 0.03], [bb.min.y, -0.03], [bb.min.z, -0.03], [bb.max.x, 13 + 0.03], [bb.max.y, 3 + 0.03], [bb.max.z, 3 + 0.03]] as Array<[number, number]>) {
      expect(got).toBeCloseTo(want, 6)
    }
  })

  it('lands posed vertices away from the origin (no double pivot subtraction)', () => {
    const boxes: RigBox[] = [
      { ...box('p', null, [0, 0, 0]), min: [0, 0, 0], max: [0, 0, 0] },
      { ...box('c', 'p', null), min: [10, 0, 0], max: [12, 2, 2] },
    ]
    const { geometry } = buildRigBoxWireGeometry(boxes[1])
    const m = composePoseMatrices(boxes, new Map([['p', [0, 0, Math.PI / 2] as JointEuler]])).get('c')!
    // Wire max corner ≈ (13.03,3.03,3.03); parent +90° about (0.5,0.5,0.5) swings it to
    // ≈ (-2.03,13.03,3.03). Pivot-relative vertices would collapse it near the origin.
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox!
    const v = new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z).applyMatrix4(m)
    for (const [got, want] of [[v.x, -2.03], [v.y, 13.03], [v.z, 3.03]] as Array<[number, number]>) {
      expect(got).toBeCloseTo(want, 6)
    }
  })
})

describe('posedPivotWorld', () => {
  it('stays put under its own rotation, rides its ancestors', () => {
    const boxes = [box('p', null, [0, 0, 0]), box('c', 'p', [0, 0, 0])]
    const own = new Map([['c', [0, 0, Math.PI / 2] as JointEuler]])
    // Own rotation is about the pivot itself.
    closeTo(posedPivotWorld(boxes, own, boxes[1]), [0.5, 0.5, 0.5])
    // Parent +90° about z swings the child's pivot (0.5,0.5,0.5) to (0.5,1.5,0.5)... around
    // the parent pivot (0.5,0.5,0.5): offset (0,0,0) stays — use an offset pivot instead.
    const off = [
      { ...box('p', null, [0, 0, 0]), pivot: [0, 0, 0] as Coord },
      { ...box('c', 'p', [0, 0, 0]), pivot: [2, 0, 0] as Coord },
    ]
    const parented = new Map([['p', [0, 0, Math.PI / 2] as JointEuler]])
    closeTo(posedPivotWorld(off, parented, off[1]), [0.5, 2.5, 0.5])
  })
})

describe('nearestRingHit', () => {
  // Orthographic stand-in: 10px per grid unit.
  const project = (p: Coord): [number, number] | null => [p[0] * 10, p[1] * 10]
  const b: RigBox = { ...box('b', null, [0, 0, 0]), min: [0, 0, 0], max: [0, 0, 0] }
  // Pivot world (0.5,0.5,0.5), radius clamped to 1.8.

  it('hits the ring under the cursor', () => {
    // Ray through the z-ring's θ=π/4 point grid (1.77,1.77,0.5) → click its px (17.7,17.7).
    const axis = nearestRingHit([], new Map(), b, [1.77, 1.77, 20], [0, 0, -1], project, 17.7, 17.7)
    expect(axis).toBe('z')
  })

  it('hits large rings exactly (no sampling gaps)', () => {
    // 10-cell box → radius clamped to 6. Ray through the z-ring flank grid (11.5,5.5,5.5).
    const big: RigBox = { ...b, id: 'big', min: [0, 0, 0], max: [9, 9, 9], pivot: null }
    const axis = nearestRingHit([], new Map(), big, [11.5, 5.5, 20], [0, 0, -1], project, 115, 55)
    expect(axis).toBe('z')
  })

  it('returns null past the threshold', () => {
    const axis = nearestRingHit([], new Map(), b, [50, 50, 20], [0, 0, -1], project, 200, 200)
    expect(axis).toBeNull()
  })

  it('prefers the nearer ring', () => {
    // Ray through grid (1.5,1.2): z-ring approach ~6px, y-ring ~7px, x-ring ~10px.
    const axis = nearestRingHit([], new Map(), b, [1.5, 1.2, 20], [0, 0, -1], project, 15, 12)
    expect(axis).toBe('z')
  })

  it('ignores unprojectable samples', () => {
    const axis = nearestRingHit([], new Map(), b, [1.77, 1.77, 20], [0, 0, -1], () => null, 17.7, 17.7)
    expect(axis).toBeNull()
  })
})

describe('intersectAxisPlane', () => {
  it('hits the axis-perpendicular plane through the point', () => {
    const hit = intersectAxisPlane([1, 1, 0], [0, 0, 1], [0, 0, 5], 'z')
    expect(hit).not.toBeNull()
    closeTo(hit!, [1, 1, 5])
  })

  it('returns null for parallel rays', () => {
    expect(intersectAxisPlane([0, 0, 0], [1, 0, 0], [0, 0, 5], 'z')).toBeNull()
  })
})

describe('angleAroundAxis', () => {
  it('reads right-hand-positive angles per axis', () => {
    const c: Coord = [0, 0, 0]
    expect(angleAroundAxis([0, 1, 0], c, 'x')).toBeCloseTo(0, 10)
    expect(angleAroundAxis([0, 0, 1], c, 'x')).toBeCloseTo(Math.PI / 2, 10)
    expect(angleAroundAxis([0, 0, 1], c, 'y')).toBeCloseTo(0, 10)
    expect(angleAroundAxis([1, 0, 0], c, 'y')).toBeCloseTo(Math.PI / 2, 10)
    expect(angleAroundAxis([1, 0, 0], c, 'z')).toBeCloseTo(0, 10)
    expect(angleAroundAxis([0, 1, 0], c, 'z')).toBeCloseTo(Math.PI / 2, 10)
  })
})
