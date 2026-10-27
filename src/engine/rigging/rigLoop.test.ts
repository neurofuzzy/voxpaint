import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Coord } from '@/engine/grid/types'
import type { RigBox, RigLoop } from './types'
import { sanitizeRigLoop } from './types'
import {
  buildRigLoopClip,
  composeLoopMatrices,
  defaultRigLoop,
  isLoopActive,
  localLoopMatrix,
  resolveRigLoopCenter,
  updateRigLoopGroupTransform,
} from './rigLoop'

function box(id: string, parentId: string | null = null, loop?: RigLoop | null): RigBox {
  return { id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId, pivot: null, loop: loop ?? null }
}

function apply(m: THREE.Matrix4, p: Coord): [number, number, number] {
  const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m)
  return [v.x, v.y, v.z]
}

describe('rigLoop', () => {
  it('defaults to a 1x turntable spin about Y', () => {
    expect(defaultRigLoop()).toEqual({ kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4 })
  })

  it('isLoopActive treats absent/null as static', () => {
    expect(isLoopActive(null)).toBe(false)
    expect(isLoopActive(undefined)).toBe(false)
    expect(isLoopActive({ kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4 })).toBe(true)
  })

  it('sanitizes hand-edited loops, clamping the slide amount', () => {
    expect(sanitizeRigLoop({ kind: 'rotate', axis: 'x', direction: -1, speed: 2, amount: 3 })).toEqual(
      { kind: 'rotate', axis: 'x', direction: -1, speed: 2, amount: 3 },
    )
    expect(sanitizeRigLoop(null)).toBeNull()
    expect(sanitizeRigLoop({ kind: 'spin', axis: 'y', direction: 1, speed: 1, amount: 4 })).toBeNull()
    expect(sanitizeRigLoop({ kind: 'slide', axis: 'w', direction: 1, speed: 1, amount: 4 })).toBeNull()
    expect(sanitizeRigLoop({ kind: 'slide', axis: 'y', direction: 1, speed: 1, amount: 99 })?.amount).toBe(8)
  })

  it('resolves the loop center at the pivot world point', () => {
    // Box [0,0,0]-[2,2,2], no pivot override → center pivot [1,1,1] → world (1.5,1.5,1.5).
    const c = resolveRigLoopCenter(box('a'))
    expect([c.x, c.y, c.z]).toEqual([1.5, 1.5, 1.5])
  })

  it('is identity at rest and for static boxes', () => {
    const loop: RigLoop = { kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4 }
    const m = localLoopMatrix(box('a', null, loop), loop, 0)
    expect(apply(m, [5, -3, 9])).toEqual([5, -3, 9])
    const s = localLoopMatrix(box('a'), null, 1.23)
    expect(apply(s, [5, -3, 9])).toEqual([5, -3, 9])
  })

  it('rotates a full turn per cycle about the pivot', () => {
    // BASE_CYCLE_SECONDS = 2 at 1x: half cycle (t=1) = π about Y through (1.5,1.5,1.5).
    const loop: RigLoop = { kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4 }
    const m = localLoopMatrix(box('a', null, loop), loop, 1)
    const [x, y, z] = apply(m, [2.5, 1.5, 1.5])
    expect(x).toBeCloseTo(0.5, 10)
    expect(y).toBeCloseTo(1.5, 10)
    expect(z).toBeCloseTo(1.5, 10)
  })

  it('slides sinusoidally along its axis', () => {
    // Quarter cycle (t=0.5 at 1x) = +amount along the axis.
    const loop: RigLoop = { kind: 'slide', axis: 'x', direction: 1, speed: 1, amount: 4 }
    const m = localLoopMatrix(box('a', null, loop), loop, 0.5)
    const [x, y, z] = apply(m, [1.5, 1.5, 1.5])
    expect(x).toBeCloseTo(5.5, 10)
    expect(y).toBeCloseTo(1.5, 10)
    expect(z).toBeCloseTo(1.5, 10)
    // Half cycle returns to origin; direction flips the sign.
    const back = localLoopMatrix(box('a', null, loop), loop, 1)
    const [bx] = apply(back, [1.5, 1.5, 1.5])
    expect(bx).toBeCloseTo(1.5, 10)
    const rev = localLoopMatrix(box('a', null, { ...loop, direction: -1 }), { ...loop, direction: -1 }, 0.5)
    const [rx] = apply(rev, [1.5, 1.5, 1.5])
    expect(rx).toBeCloseTo(-2.5, 10)
  })

  it('carries a static child inside a looped parent', () => {
    const parent = box('p', null, { kind: 'slide', axis: 'x', direction: 1, speed: 1, amount: 2 })
    const child = box('c', 'p')
    const out = composeLoopMatrices([parent, child], 0.5)
    const [x] = apply(out.get('c')!, [1.5, 1.5, 1.5])
    expect(x).toBeCloseTo(3.5, 10)
  })

  it('drives joint groups like the slice preview (position + quaternion)', () => {
    const b = box('a', null, { kind: 'slide', axis: 'z', direction: 1, speed: 2, amount: 3 })
    const group = new THREE.Group()
    updateRigLoopGroupTransform(group, b, b.loop!, 0.25)
    // speed 2 → 1s cycle; t=0.25 → sin(π/2)=1 → +3 along z from the (1.5,1.5,1.5) center.
    expect(group.position.toArray()).toEqual([1.5, 1.5, 4.5])
    expect(group.quaternion.length()).toBeCloseTo(1, 10)
  })

  it('builds rotation clips (linear) and slide clips (CUBICSPLINE) matching preview timing', () => {
    const node = new THREE.Group()
    node.name = 'prop'
    const center = new THREE.Vector3(1.5, 1.5, 1.5)
    const rot = buildRigLoopClip(node, { kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4 }, center)!
    expect(rot.duration).toBeCloseTo(2, 10)
    expect(rot.tracks).toHaveLength(1)
    const slide = buildRigLoopClip(node, { kind: 'slide', axis: 'x', direction: 1, speed: 2, amount: 4 }, center)!
    expect(slide.duration).toBeCloseTo(1, 10)
    expect(slide.tracks).toHaveLength(1)
    const track = slide.tracks[0] as unknown as {
      createInterpolant: { isInterpolantFactoryMethodGLTFCubicSpline?: boolean }
      times: ArrayLike<number>
    }
    expect(track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline).toBe(true)
    expect(track.times.length).toBe(5)
  })
})
