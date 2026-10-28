import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Coord } from '@/engine/grid/types'
import type { Pose, RigBox, RigTween } from './types'
import { sanitizeRigTween } from './types'
import {
  activeTweens,
  bakeRigClips,
  boxHasActiveTweens,
  boxTweenMatrix,
  chainHasActiveTweens,
  composeAnimatedMatrices,
  composeTweenMatrices,
  hasActiveTweens,
  isTweenActive,
  localTweenMatrix,
  newRigTween,
  pivotWorldFromMatrix,
  TWEEN_CYCLE_SECONDS,
} from './rigLoop'
import { evaluatePoseCycle, poseCycleDuration } from './pose'

function tween(over: Partial<RigTween> = {}): RigTween {
  return { id: 'tw-1', kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4, enabled: true, ...over }
}

function box(id: string, parentId: string | null = null, tweens: RigTween[] = []): RigBox {
  return { id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId, pivot: null, tweens }
}

function apply(m: THREE.Matrix4, p: Coord): [number, number, number] {
  const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m)
  return [v.x, v.y, v.z]
}

describe('rig tweens', () => {
  it('defaults to an enabled 1x turntable spin about Y', () => {
    const t = newRigTween()
    expect(t.kind).toBe('rotate')
    expect(t.axis).toBe('y')
    expect(t.enabled).toBe(true)
    expect(t.id.length).toBeGreaterThan(0)
  })

  it('treats absent/disabled tweens as static', () => {
    expect(isTweenActive(null)).toBe(false)
    expect(isTweenActive(undefined)).toBe(false)
    expect(isTweenActive(tween({ enabled: false }))).toBe(false)
    expect(boxHasActiveTweens(box('a'))).toBe(false)
    expect(boxHasActiveTweens(box('a', null, [tween({ enabled: false })]))).toBe(false)
    expect(hasActiveTweens([box('a', null, [tween()])])).toBe(true)
    expect(activeTweens(box('a', null, [tween({ id: 'x' }), tween({ id: 'y', enabled: false })])).map((t) => t.id)).toEqual(['x'])
  })

  it('sanitizes hand-edited tweens, clamping the slide amount', () => {
    expect(sanitizeRigTween({ id: 't', kind: 'rotate', axis: 'x', direction: -1, speed: 2, amount: 3 })).toEqual(
      { id: 't', kind: 'rotate', axis: 'x', direction: -1, speed: 2, amount: 3, enabled: true },
    )
    expect(sanitizeRigTween(null)).toBeNull()
    expect(sanitizeRigTween({ kind: 'spin', axis: 'y', direction: 1, speed: 1, amount: 4 })).toBeNull()
    expect(sanitizeRigTween({ kind: 'slide', axis: 'y', direction: 1, speed: 1, amount: 99 })?.amount).toBe(8)
  })

  it('is identity at rest and for disabled tweens', () => {
    const m = localTweenMatrix(box('a'), tween(), 0)
    expect(apply(m, [5, -3, 9])).toEqual([5, -3, 9])
    const s = localTweenMatrix(box('a'), tween({ enabled: false }), 1.23)
    expect(apply(s, [5, -3, 9])).toEqual([5, -3, 9])
  })

  it('rotates a full turn per cycle about the pivot', () => {
    // 2s cycle at 1x: half cycle (t=1) = π about Y through (1.5,1.5,1.5).
    const m = localTweenMatrix(box('a'), tween(), 1)
    const [x, y, z] = apply(m, [2.5, 1.5, 1.5])
    expect(x).toBeCloseTo(0.5, 10)
    expect(y).toBeCloseTo(1.5, 10)
    expect(z).toBeCloseTo(1.5, 10)
  })

  it('slides sinusoidally along its axis', () => {
    const sl = tween({ kind: 'slide', axis: 'x', amount: 4 })
    const m = localTweenMatrix(box('a'), sl, 0.5)
    const [x, y, z] = apply(m, [1.5, 1.5, 1.5])
    expect(x).toBeCloseTo(5.5, 10)
    expect(y).toBeCloseTo(1.5, 10)
    expect(z).toBeCloseTo(1.5, 10)
  })

  it('folds the stack top-first: order changes the composed motion', () => {
    // Spin about Y then shuttle along X ≠ shuttle along X then spin about Y.
    const spinY = tween({ id: 's', kind: 'rotate', axis: 'y' })
    const slideX = tween({ id: 'x', kind: 'slide', axis: 'x', amount: 2 })
    const a = boxTweenMatrix(box('a', null, [spinY, slideX]), 0.5)
    const b = boxTweenMatrix(box('a', null, [slideX, spinY]), 0.5)
    // t=0.5s of the 2s cycle = quarter cycle: spin π/2, slide +2x (sin peak).
    // m = A·B applies B first.
    const pa = apply(a, [1.5, 1.5, 1.5])
    const pb = apply(b, [1.5, 1.5, 1.5])
    expect(pa).not.toEqual(pb)
    // [spin, slide]: slide first → (3.5,1.5,1.5), then π/2 about Y swings +x to −z
    // around the center → (1.5,1.5,−0.5).
    expect(pa[0]).toBeCloseTo(1.5, 10)
    expect(pa[2]).toBeCloseTo(-0.5, 10)
    // [slide, spin]: spin first (center fixed) → (1.5,1.5,1.5), then +2x → (3.5,1.5,1.5).
    expect(pb[0]).toBeCloseTo(3.5, 10)
    expect(pb[2]).toBeCloseTo(1.5, 10)
  })

  it('carries a static child inside a tweened parent', () => {
    const parent = box('p', null, [tween({ kind: 'slide', axis: 'x', amount: 2 })])
    const child = box('c', 'p')
    const out = composeTweenMatrices([parent, child], 0.5)
    const [x] = apply(out.get('c')!, [1.5, 1.5, 1.5])
    expect(x).toBeCloseTo(3.5, 10)
  })

  it('flags a tween anywhere up the chain', () => {
    const parent = box('p', null, [tween()])
    const child = box('c', 'p')
    const grandchild = box('g', 'c')
    const boxes = [parent, child, grandchild]
    expect(chainHasActiveTweens(boxes, parent)).toBe(true)
    expect(chainHasActiveTweens(boxes, child)).toBe(true)
    expect(chainHasActiveTweens(boxes, grandchild)).toBe(true)
    expect(chainHasActiveTweens([box('a'), box('b', 'a')], box('b', 'a'))).toBe(false)
    // Dangling parents stop the walk instead of hanging.
    expect(chainHasActiveTweens([box('orphan', 'missing')], box('orphan', 'missing'))).toBe(false)
  })

  it('composes tween × pose per box in one call', () => {
    const parent = box('p', null, [tween({ kind: 'slide', axis: 'x', amount: 2 })])
    const child = box('c', 'p')
    const boxes = [parent, child]
    const pose = new Map([['c', [0, 0, Math.PI / 2] as [number, number, number]]])
    const out = composeAnimatedMatrices(boxes, pose, 0.5)
    // Quarter cycle: slide +2x on the parent, then the child's own π/2 about Z.
    // Parent chain carries the pivot: (1.5,1.5,1.5) → slide → (3.5,1.5,1.5), and the
    // child's rotation about Z through its own pivot leaves its pivot fixed there.
    const [x, y, z] = apply(out.get('c')!, [1.5, 1.5, 1.5])
    expect(x).toBeCloseTo(3.5, 10)
    expect(y).toBeCloseTo(1.5, 10)
    expect(z).toBeCloseTo(1.5, 10)
    // A non-pivot point shows both motions, child-local first: (2.5,1.5,1.5) rotates
    // π/2 about Z around the child's own pivot → (1.5,2.5,1.5), then the parent slide
    // carries it +2x → (3.5,2.5,1.5).
    const [rx, ry] = apply(out.get('c')!, [2.5, 1.5, 1.5])
    expect(rx).toBeCloseTo(3.5, 10)
    expect(ry).toBeCloseTo(2.5, 10)
  })

  it('pins a joint pivot under its own motion and carries it with ancestors', () => {
    const parent = box('p', null, [tween({ kind: 'slide', axis: 'x', amount: 2 })])
    const child = box('c', 'p')
    const boxes = [parent, child]
    const matrices = composeAnimatedMatrices(boxes, new Map(), 0.5)
    // Slide translates everything, pivot included — the child's pivot rides the parent.
    const [cx, cy, cz] = pivotWorldFromMatrix(matrices.get('c')!, child)
    expect(cx).toBeCloseTo(3.5, 10)
    expect(cy).toBeCloseTo(1.5, 10)
    expect(cz).toBeCloseTo(1.5, 10)
    // Rotate-about-own-pivot never moves it: quarter-cycle π/2 about Y fixes the center.
    const spinner = box('s', null, [tween({ kind: 'rotate', axis: 'y' })])
    const sm = composeAnimatedMatrices([spinner], new Map(), 0.5)
    const [sx, sy, sz] = pivotWorldFromMatrix(sm.get('s')!, spinner)
    expect(sx).toBeCloseTo(1.5, 10)
    expect(sy).toBeCloseTo(1.5, 10)
    expect(sz).toBeCloseTo(1.5, 10)
  })
})

describe('bakeRigClips', () => {
  function groupsFor(boxes: RigBox[]): Map<string, THREE.Group> {
    const map = new Map<string, THREE.Group>()
    for (const b of boxes) {
      const g = new THREE.Group()
      g.name = b.name
      map.set(b.id, g)
    }
    return map
  }

  it('emits one 2s LINEAR clip per tweened joint and none for static joints', () => {
    const boxes = [
      box('p', null, [tween({ id: 's', kind: 'rotate', axis: 'y' })]),
      box('c', 'p', [tween({ id: 'x', kind: 'slide', axis: 'x', amount: 3 })]),
      box('still'),
    ]
    const clips = bakeRigClips(boxes, groupsFor(boxes))
    expect(clips).toHaveLength(2)
    expect(clips.map((c) => c.name).sort()).toEqual(['anim_c', 'anim_p'])
    for (const clip of clips) {
      expect(clip.duration).toBeCloseTo(TWEEN_CYCLE_SECONDS, 10)
      expect(clip.tracks).toHaveLength(2)
    }
    const spin = clips.find((c) => c.name === 'anim_p')!
    const rotTrack = spin.tracks.find((t) => t.name === 'p.quaternion')!
    expect(rotTrack).toBeDefined()
  })

  it('bakes rest-pose endpoints: no pop at the loop seam', () => {
    const boxes = [box('p', null, [tween({ kind: 'slide', axis: 'x', amount: 3 })])]
    const [clip] = bakeRigClips(boxes, groupsFor(boxes))
    const posTrack = clip.tracks.find((t) => t.name.endsWith('.position'))!
    const values = (posTrack as unknown as { values: ArrayLike<number> }).values
    // First and last keys both equal the rest local position (parentless → pivot world point).
    expect(values[0]).toBeCloseTo(1.5, 5)
    expect(values[1]).toBeCloseTo(1.5, 5)
    expect(values[2]).toBeCloseTo(1.5, 5)
    const n = values.length
    expect(values[n - 3]).toBeCloseTo(1.5, 5)
    expect(values[n - 2]).toBeCloseTo(1.5, 5)
    expect(values[n - 1]).toBeCloseTo(1.5, 5)
  })

  it('matches the live preview matrices through the cycle (bake ≡ preview parity)', () => {
    const parent = box('p', null, [tween({ id: 's', kind: 'rotate', axis: 'y', speed: 2 })])
    const child = box('c', 'p', [tween({ id: 'x', kind: 'slide', axis: 'x', amount: 2, speed: 3 })])
    const boxes = [parent, child]
    // Bake with the full outline (the child clip is parent-frame-relative).
    const [clip] = bakeRigClips(boxes, groupsFor(boxes), 1, 30).filter((c) => c.name === 'anim_c')
    // Evaluate the baked local track at t and compare against the analytic composition:
    // local(t) = T(−pp) · parentMotion⁻¹(t) · selfMotion(t) · T(p).
    const posTrack = clip.tracks.find((t) => t.name.endsWith('.position'))! as unknown as { times: ArrayLike<number>; values: ArrayLike<number> }
    const quatTrack = clip.tracks.find((t) => t.name.endsWith('.quaternion'))! as unknown as { times: ArrayLike<number>; values: ArrayLike<number> }
    const sample = (track: { times: ArrayLike<number>; values: ArrayLike<number> }, size: number, t: number) => {
      // Piecewise-linear lookup on the baked keys.
      const times = track.times
      let i = 0
      while (i < times.length - 2 && times[i + 1] < t) i++
      const t0 = times[i]
      const t1 = times[i + 1]
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0
      const out: number[] = []
      for (let k = 0; k < size; k++) out.push(track.values[i * size + k] * (1 - f) + track.values[(i + 1) * size + k] * f)
      return out
    }
    for (const t of [0.13, 0.5, 1.17, 1.9]) {
      const worlds = composeTweenMatrices(boxes, t)
      const expected = new THREE.Matrix4()
        .makeTranslation(-1.5, -1.5, -1.5)
        .multiply(new THREE.Matrix4().copy(worlds.get('p')!).invert())
        .multiply(worlds.get('c')!)
        .multiply(new THREE.Matrix4().makeTranslation(1.5, 1.5, 1.5))
      const ep = new THREE.Vector3()
      const eq = new THREE.Quaternion()
      expected.decompose(ep, eq, new THREE.Vector3())
      const [px, py, pz] = sample(posTrack, 3, t)
      // LINEAR keys at 30fps approximate the analytic sine — sub-voxel (5%-of-voxel) error.
      expect(px).toBeCloseTo(ep.x, 1)
      expect(py).toBeCloseTo(ep.y, 1)
      expect(pz).toBeCloseTo(ep.z, 1)
      const [qx, qy, qz, qw] = sample(quatTrack, 4, t)
      // Quaternion double-cover: compare with sign normalized.
      const dot = qx * eq.x + qy * eq.y + qz * eq.z + qw * eq.w
      expect(Math.abs(dot)).toBeCloseTo(1, 2)
    }
  })
})

describe('bakeRigClips with a pose cycle', () => {
  function groupsFor(boxes: RigBox[]): Map<string, THREE.Group> {
    const map = new Map<string, THREE.Group>()
    for (const b of boxes) {
      const g = new THREE.Group()
      g.name = b.name
      map.set(b.id, g)
    }
    return map
  }

  const poses: Pose[] = [
    { id: 'a', name: 'A', joints: {} },
    { id: 'b', name: 'B', joints: { c: [0, Math.PI / 2, 0] } },
  ]
  const cycle = { fromId: 'a', toId: 'b', mode: 'once' as const, speed: 1 as const }
  const pose = {
    at: (t: number) => evaluatePoseCycle(poses, cycle, t) ?? new Map(),
    duration: poseCycleDuration(cycle),
  }

  it('emits clips for posed joints even with no tweens, sized to the cycle pass', () => {
    // No tweens anywhere — the posed child still bakes; the static parent emits nothing.
    const boxes = [box('p'), box('c', 'p')]
    const clips = bakeRigClips(boxes, groupsFor(boxes), 1, 30, pose)
    expect(clips.map((c) => c.name)).toEqual(['anim_c'])
    // Once at 1x covers a single 2s half cycle.
    expect(clips[0].duration).toBeCloseTo(2, 10)
  })

  it('extends the window to a full ping-pong pass', () => {
    const boxes = [box('c')]
    const pingpong = { ...cycle, mode: 'pingpong' as const }
    const clips = bakeRigClips(boxes, groupsFor(boxes), 1, 30, {
      at: (t: number) => evaluatePoseCycle(poses, pingpong, t) ?? new Map(),
      duration: poseCycleDuration(pingpong),
    })
    expect(clips[0].duration).toBeCloseTo(4, 10)
  })

  it('matches the live preview with pose + tween composed', () => {
    // Parent spins (tween), child holds a posed rotation: the baked child clip must carry
    // the parent's motion in its parent-relative frame plus its own pose offset.
    const parent = box('p', null, [tween({ id: 's', kind: 'rotate', axis: 'y', speed: 1 })])
    const child = box('c', 'p')
    const boxes = [parent, child]
    const posed = {
      at: (t: number) => evaluatePoseCycle(poses, cycle, t) ?? new Map(),
      duration: poseCycleDuration(cycle),
    }
    const [clip] = bakeRigClips(boxes, groupsFor(boxes), 1, 30, posed).filter((c) => c.name === 'anim_c')
    expect(clip).toBeDefined()
    const posTrack = clip.tracks.find((t) => t.name.endsWith('.position'))! as unknown as { times: ArrayLike<number>; values: ArrayLike<number> }
    const quatTrack = clip.tracks.find((t) => t.name.endsWith('.quaternion'))! as unknown as { times: ArrayLike<number>; values: ArrayLike<number> }
    const sample = (track: { times: ArrayLike<number>; values: ArrayLike<number> }, size: number, t: number) => {
      const times = track.times
      let i = 0
      while (i < times.length - 2 && times[i + 1] < t) i++
      const t0 = times[i]
      const t1 = times[i + 1]
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0
      const out: number[] = []
      for (let k = 0; k < size; k++) out.push(track.values[i * size + k] * (1 - f) + track.values[(i + 1) * size + k] * f)
      return out
    }
    for (const t of [0.25, 0.75, 1.5]) {
      const worlds = composeTweenMatrices(boxes, t)
      void worlds
      const animated = composeAnimatedMatrices(boxes, posed.at(t), t)
      const expected = new THREE.Matrix4()
        .makeTranslation(-1.5, -1.5, -1.5)
        .multiply(new THREE.Matrix4().copy(animated.get('p')!).invert())
        .multiply(animated.get('c')!)
        .multiply(new THREE.Matrix4().makeTranslation(1.5, 1.5, 1.5))
      const ep = new THREE.Vector3()
      const eq = new THREE.Quaternion()
      expected.decompose(ep, eq, new THREE.Vector3())
      const [px, py, pz] = sample(posTrack, 3, t)
      expect(px).toBeCloseTo(ep.x, 1)
      expect(py).toBeCloseTo(ep.y, 1)
      expect(pz).toBeCloseTo(ep.z, 1)
      const [qx, qy, qz, qw] = sample(quatTrack, 4, t)
      const dot = qx * eq.x + qy * eq.y + qz * eq.z + qw * eq.w
      expect(Math.abs(dot)).toBeCloseTo(1, 2)
    }
  })
})
