import { describe, expect, it } from 'vitest'
import type { Coord } from '@/engine/grid/types'
import {
  CLIP_FRAME_SECONDS,
  newClipId,
  newKeyId,
  sanitizePose,
  sanitizeRigClip,
  snapClipTime,
} from './types'
import type { Pose, RigBox, RigClip } from './types'
import { clipFromPoseCycle, deriveAnimationMode, easePhase, evaluateClip } from './clip'

function box(id: string, parentId: string | null = null): RigBox {
  return { id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId, pivot: null }
}

function pose(
  id: string,
  joints: Record<string, [number, number, number]> = {},
  offsets?: Record<string, Coord>,
): Pose {
  return offsets ? { id, name: id, joints, offsets } : { id, name: id, joints }
}

const A = pose('a')
const B = pose('b', { arm: [0, Math.PI / 2, 0] })

function twoKeyLoop(): RigClip {
  return {
    id: 'clip',
    name: 'walk',
    loop: true,
    duration: 4,
    keys: [
      { id: 'k0', poseId: 'a', time: 0, ease: 'inOut' },
      { id: 'k1', poseId: 'b', time: 2, ease: 'inOut' },
    ],
  }
}

describe('easePhase', () => {
  it('passes linear through and pins every endpoint', () => {
    expect(easePhase('linear', 0.37)).toBeCloseTo(0.37, 10)
    for (const ease of ['linear', 'inOut', 'in', 'out'] as const) {
      expect(easePhase(ease, 0)).toBe(0)
      expect(easePhase(ease, 1)).toBe(1)
    }
  })

  it('eases in-out through the midpoint like the old pose cycle', () => {
    expect(easePhase('inOut', 0.5)).toBeCloseTo(0.5, 10)
    expect(easePhase('inOut', 0.25)).toBeCloseTo(0.5 - 0.5 * Math.cos(Math.PI * 0.25), 10)
  })

  it('starts slow on in, ends slow on out', () => {
    expect(easePhase('in', 0.5)).toBeCloseTo(1 - Math.cos(Math.PI / 4), 10)
    expect(easePhase('in', 0.5)).toBeLessThan(0.5)
    expect(easePhase('out', 0.5)).toBeCloseTo(Math.sin(Math.PI / 4), 10)
    expect(easePhase('out', 0.5)).toBeGreaterThan(0.5)
  })

  it('holds at zero until the next key (a step)', () => {
    expect(easePhase('hold', 0)).toBe(0)
    expect(easePhase('hold', 0.5)).toBe(0)
    expect(easePhase('hold', 0.999)).toBe(0)
  })

  it('clamps out-of-range phases', () => {
    expect(easePhase('linear', -2)).toBe(0)
    expect(easePhase('linear', 2)).toBe(1)
    expect(easePhase('hold', 5)).toBe(0)
  })
})

describe('sanitizeRigClip', () => {
  const valid = new Set(['a', 'b'])

  it('sorts keys, forces the first to 0, and snaps times to 1/30 s', () => {
    const clip = sanitizeRigClip(
      {
        id: 'c',
        name: 'walk',
        loop: true,
        duration: 4,
        keys: [
          { id: 'late', poseId: 'b', time: 2.04, ease: 'linear' },
          { id: 'early', poseId: 'a', time: 0.5, ease: 'linear' },
        ],
      },
      valid,
    )!
    expect(clip.keys.map((k) => k.poseId)).toEqual(['a', 'b'])
    expect(clip.keys[0].time).toBe(0)
    // 2.04 s snaps to the nearest frame (61/30).
    expect(clip.keys[1].time).toBeCloseTo(61 / 30, 10)
  })

  it('keeps a clip whose keys all dangle as an empty shell (duration defaults to 1 s)', () => {
    const clip = sanitizeRigClip(
      { id: 'c', name: 'c', loop: true, duration: 2, keys: [{ id: 'k', poseId: 'ghost', time: 0, ease: 'linear' }] },
      valid,
    )!
    // A new unkeyed clip (or one whose poses were all deleted) survives save/load.
    expect(clip).not.toBeNull()
    expect(clip.keys).toEqual([])
    expect(clip.duration).toBeCloseTo(2, 10)
    const fresh = sanitizeRigClip(
      { id: 'c', name: 'c', loop: true, keys: [] },
      valid,
    )!
    expect(fresh.keys).toEqual([])
    expect(fresh.duration).toBeCloseTo(1, 10)
    expect(sanitizeRigClip(null, valid)).toBeNull()
    expect(sanitizeRigClip({ id: 'c', name: 'c', loop: true, duration: 2 }, valid)).toBeNull()
  })

  it('drops keys with non-finite times and defaults bad eases to inOut', () => {
    const clip = sanitizeRigClip(
      {
        id: 'c',
        name: 'c',
        loop: false,
        duration: 1,
        keys: [
          { id: 'k0', poseId: 'a', time: 0, ease: 'sideways' },
          { id: 'k1', poseId: 'b', time: NaN, ease: 'linear' },
        ],
      },
      valid,
    )!
    expect(clip.keys).toHaveLength(1)
    expect(clip.keys[0].ease).toBe('inOut')
  })

  it('clamps duration to the last key time and above zero', () => {
    const short = sanitizeRigClip(
      { id: 'c', name: 'c', loop: false, duration: 0.5, keys: [{ id: 'k0', poseId: 'a', time: 0, ease: 'linear' }, { id: 'k1', poseId: 'b', time: 1.5, ease: 'linear' }] },
      valid,
    )!
    expect(short.duration).toBeCloseTo(1.5, 10)
    // A single key at 0 still yields a positive (one-frame) duration.
    const single = sanitizeRigClip(
      { id: 'c', name: 'c', loop: false, duration: 0, keys: [{ id: 'k0', poseId: 'a', time: 0, ease: 'linear' }] },
      valid,
    )!
    expect(single.duration).toBeGreaterThan(0)
    expect(single.duration).toBeCloseTo(CLIP_FRAME_SECONDS, 10)
  })

  it('holds a looping clip at least one frame past its last key (no wrap pop)', () => {
    const looped = sanitizeRigClip(
      { id: 'c', name: 'c', loop: true, duration: 1.5, keys: [{ id: 'k0', poseId: 'a', time: 0, ease: 'linear' }, { id: 'k1', poseId: 'b', time: 1.5, ease: 'linear' }] },
      valid,
    )!
    expect(looped.duration).toBeCloseTo(1.5 + CLIP_FRAME_SECONDS, 10)
    // A non-looping clip still clamps exactly to its last key.
    const once = sanitizeRigClip(
      { id: 'c', name: 'c', loop: false, duration: 1.5, keys: [{ id: 'k0', poseId: 'a', time: 0, ease: 'linear' }, { id: 'k1', poseId: 'b', time: 1.5, ease: 'linear' }] },
      valid,
    )!
    expect(once.duration).toBeCloseTo(1.5, 10)
  })

  it('fills in missing ids, names, and loop flags', () => {
    const clip = sanitizeRigClip({ keys: [{ poseId: 'a', time: 0, ease: 'linear' }] }, valid)!
    expect(clip.id.length).toBeGreaterThan(0)
    expect(clip.name).toBe('clip')
    expect(clip.loop).toBe(true)
    expect(clip.keys[0].id.length).toBeGreaterThan(0)
    expect(newClipId().length).toBeGreaterThan(0)
    expect(newKeyId().length).toBeGreaterThan(0)
    expect(snapClipTime(0.05)).toBeCloseTo(2 / 30, 10)
  })
})

describe('sanitizePose offsets', () => {
  const valid = new Set(['hips', 'arm'])

  it('keeps finite offset triples on known boxes', () => {
    const p = sanitizePose({ id: 'p', name: 'P', joints: {}, offsets: { hips: [0, 1.5, 0] } }, valid)!
    expect(p.offsets).toEqual({ hips: [0, 1.5, 0] })
  })

  it('drops non-finite triples and unknown box ids', () => {
    const p = sanitizePose(
      { id: 'p', name: 'P', joints: {}, offsets: { hips: [0, NaN, 0], ghost: [1, 0, 0], arm: [1, 2] } },
      valid,
    )!
    expect(p.offsets).toBeUndefined()
  })

  it('omits the field when no offsets were authored', () => {
    const p = sanitizePose({ id: 'p', name: 'P', joints: { arm: [0.5, 0, 0] } }, valid)!
    expect(p).toEqual({ id: 'p', name: 'P', joints: { arm: [0.5, 0, 0] } })
    expect('offsets' in p).toBe(false)
  })
})

describe('evaluateClip', () => {
  const poses = [A, B]

  it('wraps a loop back to the first key with a continuous seam', () => {
    const clip = twoKeyLoop()
    // Pose A is bind for arm (absent entries ARE bind).
    const armOf = (t: number) => evaluateClip(poses, [], clip, t).rot.get('arm') ?? [0, 0, 0]
    const atStart = armOf(0)
    expect(atStart).toEqual([0, 0, 0])
    expect(armOf(4)).toEqual(atStart)
    const nearSeam = armOf(3.999)
    for (let i = 0; i < 3; i++) expect(nearSeam[i]).toBeCloseTo(atStart[i], 4)
    // Halfway out sits halfway slerped (in-out phase 0.5).
    const mid = evaluateClip(poses, [], clip, 1).rot.get('arm')!
    expect(mid[1]).toBeCloseTo(Math.PI / 4, 5)
    // The turnaround hits B exactly.
    expect(evaluateClip(poses, [], clip, 2).rot.get('arm')).toEqual([0, Math.PI / 2, 0])
  })

  it('holds the outgoing pose through a hold segment, then steps', () => {
    const clip: RigClip = {
      id: 'c',
      name: 'h',
      loop: false,
      duration: 1,
      keys: [
        { id: 'k0', poseId: 'a', time: 0, ease: 'hold' },
        { id: 'k1', poseId: 'b', time: 1, ease: 'linear' },
      ],
    }
    expect(evaluateClip([A, B], [], clip, 0.5).rot.get('arm')).toEqual([0, 0, 0])
    expect(evaluateClip([A, B], [], clip, 0.999).rot.get('arm')).toEqual([0, 0, 0])
    expect(evaluateClip([A, B], [], clip, 1).rot.get('arm')).toEqual([0, Math.PI / 2, 0])
  })

  it('clamps a non-loop past the end and before the start', () => {
    const clip: RigClip = { ...twoKeyLoop(), loop: false, duration: 2 }
    expect(evaluateClip(poses, [], clip, 99).rot.get('arm')).toEqual([0, Math.PI / 2, 0])
    expect(evaluateClip(poses, [], clip, 2).rot.get('arm')).toEqual([0, Math.PI / 2, 0])
    expect(evaluateClip(poses, [], clip, -5).rot).toEqual(evaluateClip(poses, [], clip, 0).rot)
  })

  it('reads a dangling pose as bind', () => {
    // Wholly dangling: an empty (bind) frame.
    const ghost: RigClip = {
      id: 'c',
      name: 'g',
      loop: false,
      duration: 1,
      keys: [{ id: 'k0', poseId: 'ghost', time: 0, ease: 'linear' }],
    }
    const frame = evaluateClip(poses, [], ghost, 0.5)
    expect(frame.rot.size).toBe(0)
    expect(frame.off.size).toBe(0)
    // Half-dangling: the known side blends toward bind.
    const half: RigClip = {
      id: 'c',
      name: 'h',
      loop: false,
      duration: 2,
      keys: [
        { id: 'k0', poseId: 'b', time: 0, ease: 'linear' },
        { id: 'k1', poseId: 'ghost', time: 2, ease: 'linear' },
      ],
    }
    expect(evaluateClip([A, B], [], half, 1).rot.get('arm')![1]).toBeCloseTo(Math.PI / 4, 5)
  })

  it('lerps root offsets and ignores non-root offsets', () => {
    const boxes = [box('hips'), box('shin', 'hips')]
    const from = pose('p0', {}, { hips: [0, 0, 0], shin: [0, 5, 5] })
    const to = pose('p1', {}, { hips: [0, 2, 0] })
    const clip: RigClip = {
      id: 'c',
      name: 'bob',
      loop: false,
      duration: 2,
      keys: [
        { id: 'k0', poseId: 'p0', time: 0, ease: 'linear' },
        { id: 'k1', poseId: 'p1', time: 2, ease: 'linear' },
      ],
    }
    const mid = evaluateClip([from, to], boxes, clip, 1)
    expect(mid.off.get('hips')).toEqual([0, 1, 0])
    expect(mid.off.has('shin')).toBe(false)
  })

  it('yields an empty frame for an empty clip', () => {
    const frame = evaluateClip(poses, [], { id: 'c', name: 'e', loop: false, duration: 1, keys: [] }, 0.5)
    expect(frame.rot.size).toBe(0)
    expect(frame.off.size).toBe(0)
  })
})

describe('clipFromPoseCycle', () => {
  it('maps once to a non-looping two-key clip over one half cycle', () => {
    const clip = clipFromPoseCycle({ fromId: 'a', toId: 'b', mode: 'once', speed: 1 })
    expect(clip.name).toBe('cycle')
    expect(clip.loop).toBe(false)
    expect(clip.duration).toBeCloseTo(2, 10)
    expect(clip.keys.map((k) => [k.poseId, k.time, k.ease])).toEqual([
      ['a', 0, 'inOut'],
      ['b', 2, 'inOut'],
    ])
    expect(clip.keys[0].id).not.toBe(clip.keys[1].id)
  })

  it('maps loop and pingpong to seamless two-key loops over the full pass', () => {
    const looped = clipFromPoseCycle({ fromId: 'a', toId: 'b', mode: 'loop', speed: 2 })
    expect(looped.loop).toBe(true)
    // Half cycle at 2x is 1 s; the seamless loop covers out-and-back.
    expect(looped.duration).toBeCloseTo(2, 10)
    expect(looped.keys.map((k) => k.time)).toEqual([0, 1])
    const pingpong = clipFromPoseCycle({ fromId: 'a', toId: 'b', mode: 'pingpong', speed: 1 })
    expect(pingpong.loop).toBe(true)
    expect(pingpong.duration).toBeCloseTo(4, 10)
  })

  it('evaluates a converted pingpong as an out-and-back loop', () => {
    const clip = clipFromPoseCycle({ fromId: 'a', toId: 'b', mode: 'pingpong', speed: 1 })
    const armOf = (t: number) => evaluateClip([A, B], [], clip, t).rot.get('arm') ?? [0, 0, 0]
    // From A at 0, to B at half the pass, back to A at the wrap.
    expect(armOf(0)).toEqual([0, 0, 0])
    expect(armOf(2)).toEqual([0, Math.PI / 2, 0])
    for (let i = 0; i < 3; i++) expect(armOf(4)[i]).toBeCloseTo(0, 5)
    // Midway out eases halfway (in-out phase 0.5 slerps half the angle).
    expect(armOf(1)[1]).toBeCloseTo(Math.PI / 4, 5)
    // ... and the way back mirrors the way out.
    expect(armOf(3)[1]).toBeCloseTo(Math.PI / 4, 5)
  })
})

describe('deriveAnimationMode', () => {
  const tweens = [{ id: 'tw', kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4, minAngle: -30, maxAngle: 30, enabled: true } as const]

  it('uses poses when poses exist and no tween is enabled', () => {
    const muted: RigBox[] = [{ ...box('a'), tweens: [{ ...tweens[0], enabled: false }] }]
    expect(deriveAnimationMode({ rigBoxes: muted, poses: [A] })).toBe('poses')
    expect(deriveAnimationMode({ rigBoxes: [box('a')], poses: [A] })).toBe('poses')
  })

  it('uses tweens when a tween is enabled or when neither system is in use', () => {
    const tweened: RigBox[] = [{ ...box('a'), tweens: [...tweens] }]
    expect(deriveAnimationMode({ rigBoxes: tweened, poses: [A] })).toBe('tweens')
    expect(deriveAnimationMode({ rigBoxes: [box('a')], poses: [] })).toBe('tweens')
    expect(deriveAnimationMode({ rigBoxes: [], poses: [] })).toBe('tweens')
  })
})
