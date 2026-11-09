import { describe, expect, it } from 'vitest'
import type { Coord } from '@/engine/grid/types'
import {
  CLIP_FRAME_SECONDS,
  newClipId,
  newKeyId,
  normalizeFps,
  sanitizeKeyJoints,
  sanitizeKeyOffsets,
  sanitizeRigClip,
  snapClipTime,
} from './types'
import type { ClipKey, RigBox, RigClip } from './types'
import { clipFromPoseCycle, deriveAnimationMode, easePhase, evaluateClip, sampleKeyPayload } from './clip'

function box(id: string, parentId: string | null = null): RigBox {
  return { id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId, pivot: null }
}

function key(
  id: string,
  name: string,
  time: number,
  ease: ClipKey['ease'],
  joints: Record<string, [number, number, number]> = {},
  offsets?: Record<string, Coord>,
): ClipKey {
  return offsets ? { id, name, time, ease, joints, offsets } : { id, name, time, ease, joints }
}

function twoKeyLoop(): RigClip {
  return {
    id: 'clip',
    name: 'walk',
    loop: true,
    duration: 4,
    keys: [
      key('k0', 'A', 0, 'inOut'),
      key('k1', 'B', 2, 'inOut', { arm: [0, Math.PI / 2, 0] }),
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
  it('sorts keys, forces the first to 0, and snaps times to 1/30 s', () => {
    const clip = sanitizeRigClip({
      id: 'c',
      name: 'walk',
      loop: true,
      duration: 4,
      keys: [
        { id: 'late', name: 'B', time: 2.04, ease: 'linear', joints: {} },
        { id: 'early', name: 'A', time: 0.5, ease: 'linear', joints: {} },
      ],
    })!
    expect(clip.keys.map((k) => k.name)).toEqual(['A', 'B'])
    expect(clip.keys[0].time).toBe(0)
    // 2.04 s snaps to the nearest frame (61/30).
    expect(clip.keys[1].time).toBeCloseTo(61 / 30, 10)
  })

  it('materializes an empty key array as a bind frame-1 anchor', () => {
    // A new unkeyed clip survives save/load with a keyframe at 0.
    const clip = sanitizeRigClip({ id: 'c', name: 'c', loop: true, duration: 2, keys: [] })!
    expect(clip).not.toBeNull()
    expect(clip.keys).toHaveLength(1)
    expect(clip.keys[0].time).toBe(0)
    expect(clip.keys[0].joints).toEqual({})
    expect(clip.duration).toBeCloseTo(2, 10)
    const fresh = sanitizeRigClip({ id: 'c', name: 'c', loop: true, keys: [] })!
    expect(fresh.keys).toHaveLength(1)
    expect(fresh.duration).toBeCloseTo(1, 10)
    expect(sanitizeRigClip(null)).toBeNull()
    expect(sanitizeRigClip({ id: 'c', name: 'c', loop: true, duration: 2 })).toBeNull()
  })

  it('drops keys with non-finite times and defaults bad eases and names', () => {
    const clip = sanitizeRigClip({
      id: 'c',
      name: 'c',
      loop: false,
      duration: 1,
      keys: [
        { id: 'k0', time: 0, ease: 'sideways', joints: {} },
        { id: 'k1', name: 'B', time: NaN, ease: 'linear', joints: {} },
      ],
    })!
    expect(clip.keys).toHaveLength(1)
    expect(clip.keys[0].ease).toBe('inOut')
    expect(clip.keys[0].name).toBe('Key')
  })

  it('sanitizes joint entries within surviving keys', () => {
    const clip = sanitizeRigClip({
      id: 'c',
      name: 'c',
      loop: false,
      duration: 1,
      keys: [
        {
          id: 'k0', name: 'A', time: 0, ease: 'linear',
          joints: { arm: [0.5, 0, 0], bad: [1, 'x', 0] as unknown as [number, number, number], short: [1, 2] as unknown as [number, number, number] },
          offsets: { hips: [0, 1.5, 0], bad: [0, NaN, 0] },
        },
      ],
    })!
    expect(clip.keys[0].joints).toEqual({ arm: [0.5, 0, 0] })
    expect(clip.keys[0].offsets).toEqual({ hips: [0, 1.5, 0] })
  })

  it('omits offsets when none survive', () => {
    const clip = sanitizeRigClip({
      id: 'c', name: 'c', loop: false, duration: 1,
      keys: [{ id: 'k0', name: 'A', time: 0, ease: 'linear', joints: { arm: [0.5, 0, 0] } }],
    })!
    expect('offsets' in clip.keys[0]).toBe(false)
  })

  it('clamps duration to the last key time and above zero', () => {
    const short = sanitizeRigClip({
      id: 'c', name: 'c', loop: false, duration: 0.5,
      keys: [
        { id: 'k0', name: 'A', time: 0, ease: 'linear', joints: {} },
        { id: 'k1', name: 'B', time: 1.5, ease: 'linear', joints: {} },
      ],
    })!
    expect(short.duration).toBeCloseTo(1.5, 10)
    // A single key at 0 still yields a positive (one-frame) duration.
    const single = sanitizeRigClip({
      id: 'c', name: 'c', loop: false, duration: 0,
      keys: [{ id: 'k0', name: 'A', time: 0, ease: 'linear', joints: {} }],
    })!
    expect(single.duration).toBeGreaterThan(0)
    expect(single.duration).toBeCloseTo(CLIP_FRAME_SECONDS, 10)
  })

  it('holds a looping clip at least one frame past its last key (no wrap pop)', () => {
    const looped = sanitizeRigClip({
      id: 'c', name: 'c', loop: true, duration: 1.5,
      keys: [
        { id: 'k0', name: 'A', time: 0, ease: 'linear', joints: {} },
        { id: 'k1', name: 'B', time: 1.5, ease: 'linear', joints: {} },
      ],
    })!
    expect(looped.duration).toBeCloseTo(1.5 + CLIP_FRAME_SECONDS, 10)
    // A non-looping clip still clamps exactly to its last key.
    const once = sanitizeRigClip({
      id: 'c', name: 'c', loop: false, duration: 1.5,
      keys: [
        { id: 'k0', name: 'A', time: 0, ease: 'linear', joints: {} },
        { id: 'k1', name: 'B', time: 1.5, ease: 'linear', joints: {} },
      ],
    })!
    expect(once.duration).toBeCloseTo(1.5, 10)
  })

  it('fills in missing ids, names, and loop flags', () => {
    const clip = sanitizeRigClip({ keys: [{ time: 0, ease: 'linear', joints: {} }] })!
    expect(clip.id.length).toBeGreaterThan(0)
    expect(clip.name).toBe('clip')
    expect(clip.loop).toBe(true)
    expect(clip.keys[0].id.length).toBeGreaterThan(0)
    expect(clip.keys[0].name).toBe('Key')
    expect(newClipId().length).toBeGreaterThan(0)
    expect(newKeyId().length).toBeGreaterThan(0)
    expect(snapClipTime(0.05)).toBeCloseTo(2 / 30, 10)
  })
})

describe('project frame rate', () => {
  it('normalizes to integers 1–120, defaulting to 30', () => {
    expect(normalizeFps(undefined)).toBe(30)
    expect(normalizeFps('fast')).toBe(30)
    expect(normalizeFps(24)).toBe(24)
    expect(normalizeFps(29.7)).toBe(30)
    expect(normalizeFps(0)).toBe(1)
    expect(normalizeFps(-5)).toBe(1)
    expect(normalizeFps(1000)).toBe(120)
  })

  it('snaps times to the given frame grid', () => {
    expect(snapClipTime(0.05)).toBeCloseTo(2 / 30, 10)
    expect(snapClipTime(0.05, 12)).toBeCloseTo(1 / 12, 10)
    expect(snapClipTime(0.05, 24)).toBeCloseTo(1 / 24, 10)
  })

  it('sanitizes clips onto the given frame grid', () => {
    const clip = sanitizeRigClip(
      {
        id: 'c', name: 'c', loop: false, duration: 1,
        keys: [
          { id: 'k0', name: 'A', time: 0, ease: 'linear', joints: {} },
          { id: 'k1', name: 'B', time: 0.05, ease: 'linear', joints: {} },
        ],
      },
      12,
    )!
    expect(clip.keys[1].time).toBeCloseTo(1 / 12, 10)
    expect(clip.duration).toBeCloseTo(1, 10)
  })
})

describe('sanitizeKeyJoints / sanitizeKeyOffsets', () => {
  it('keeps finite triples and drops the rest', () => {
    expect(sanitizeKeyJoints({ arm: [0.5, 0, 0], bad: [1, 'x', 0], short: [1, 2] })).toEqual({
      arm: [0.5, 0, 0],
    })
    expect(sanitizeKeyJoints(null)).toEqual({})
    expect(sanitizeKeyOffsets({ hips: [0, 1.5, 0], bad: [0, NaN, 0] })).toEqual({ hips: [0, 1.5, 0] })
    expect(sanitizeKeyOffsets(undefined)).toBeUndefined()
    expect(sanitizeKeyOffsets({ bad: [0, NaN, 0] })).toBeUndefined()
  })
})

describe('evaluateClip', () => {
  it('wraps a loop back to the first key with a continuous seam', () => {
    const clip = twoKeyLoop()
    // Key A is bind for arm (absent entries ARE bind).
    const armOf = (t: number) => evaluateClip([], clip, t).rot.get('arm') ?? [0, 0, 0]
    const atStart = armOf(0)
    expect(atStart).toEqual([0, 0, 0])
    expect(armOf(4)).toEqual(atStart)
    const nearSeam = armOf(3.999)
    for (let i = 0; i < 3; i++) expect(nearSeam[i]).toBeCloseTo(atStart[i], 4)
    // Halfway out sits halfway slerped (in-out phase 0.5).
    const mid = evaluateClip([], clip, 1).rot.get('arm')!
    expect(mid[1]).toBeCloseTo(Math.PI / 4, 5)
    // The turnaround hits B exactly.
    expect(evaluateClip([], clip, 2).rot.get('arm')).toEqual([0, Math.PI / 2, 0])
  })

  it('holds the outgoing pose through a hold segment, then steps', () => {
    const clip: RigClip = {
      id: 'c',
      name: 'h',
      loop: false,
      duration: 1,
      keys: [
        key('k0', 'A', 0, 'hold'),
        key('k1', 'B', 1, 'linear', { arm: [0, Math.PI / 2, 0] }),
      ],
    }
    expect(evaluateClip([], clip, 0.5).rot.get('arm')).toEqual([0, 0, 0])
    expect(evaluateClip([], clip, 0.999).rot.get('arm')).toEqual([0, 0, 0])
    expect(evaluateClip([], clip, 1).rot.get('arm')).toEqual([0, Math.PI / 2, 0])
  })

  it('clamps a non-loop past the end and before the start', () => {
    const clip: RigClip = { ...twoKeyLoop(), loop: false, duration: 2 }
    expect(evaluateClip([], clip, 99).rot.get('arm')).toEqual([0, Math.PI / 2, 0])
    expect(evaluateClip([], clip, 2).rot.get('arm')).toEqual([0, Math.PI / 2, 0])
    expect(evaluateClip([], clip, -5).rot).toEqual(evaluateClip([], clip, 0).rot)
  })

  it('blends an absent joint from bind', () => {
    // A joint keyed on only one side blends toward bind (absent = bind).
    const half: RigClip = {
      id: 'c',
      name: 'h',
      loop: false,
      duration: 2,
      keys: [
        key('k0', 'B', 0, 'linear', { arm: [0, Math.PI / 2, 0] }),
        key('k1', 'A', 2, 'linear'),
      ],
    }
    expect(evaluateClip([], half, 1).rot.get('arm')![1]).toBeCloseTo(Math.PI / 4, 5)
  })

  it('lerps root offsets and ignores non-root offsets', () => {
    const boxes = [box('hips'), box('shin', 'hips')]
    const clip: RigClip = {
      id: 'c',
      name: 'bob',
      loop: false,
      duration: 2,
      keys: [
        key('k0', 'from', 0, 'linear', {}, { hips: [0, 0, 0], shin: [0, 5, 5] }),
        key('k1', 'to', 2, 'linear', {}, { hips: [0, 2, 0] }),
      ],
    }
    const mid = evaluateClip(boxes, clip, 1)
    expect(mid.off.get('hips')).toEqual([0, 1, 0])
    expect(mid.off.has('shin')).toBe(false)
  })

  it('yields an empty frame for an empty clip', () => {
    const frame = evaluateClip([], { id: 'c', name: 'e', loop: false, duration: 1, keys: [] }, 0.5)
    expect(frame.rot.size).toBe(0)
    expect(frame.off.size).toBe(0)
  })
})

describe('clipFromPoseCycle', () => {
  const A = { id: 'a', name: 'A', joints: {} }
  const B = { id: 'b', name: 'B', joints: { arm: [0, Math.PI / 2, 0] as [number, number, number] } }

  it('maps once to a non-looping two-key clip over one half cycle', () => {
    const clip = clipFromPoseCycle({ fromId: 'a', toId: 'b', mode: 'once', speed: 1 }, [A, B])
    expect(clip.name).toBe('cycle')
    expect(clip.loop).toBe(false)
    expect(clip.duration).toBeCloseTo(2, 10)
    expect(clip.keys.map((k) => [k.name, k.time, k.ease])).toEqual([
      ['A', 0, 'inOut'],
      ['B', 2, 'inOut'],
    ])
    expect(clip.keys[0].joints).toEqual({})
    expect(clip.keys[1].joints).toEqual({ arm: [0, Math.PI / 2, 0] })
    expect(clip.keys[0].id).not.toBe(clip.keys[1].id)
  })

  it('maps loop and pingpong to seamless two-key loops over the full pass', () => {
    const looped = clipFromPoseCycle({ fromId: 'a', toId: 'b', mode: 'loop', speed: 2 }, [A, B])
    expect(looped.loop).toBe(true)
    // Half cycle at 2x is 1 s; the seamless loop covers out-and-back.
    expect(looped.duration).toBeCloseTo(2, 10)
    expect(looped.keys.map((k) => k.time)).toEqual([0, 1])
    const pingpong = clipFromPoseCycle({ fromId: 'a', toId: 'b', mode: 'pingpong', speed: 1 }, [A, B])
    expect(pingpong.loop).toBe(true)
    expect(pingpong.duration).toBeCloseTo(4, 10)
  })

  it('evaluates a converted pingpong as an out-and-back loop', () => {
    const clip = clipFromPoseCycle({ fromId: 'a', toId: 'b', mode: 'pingpong', speed: 1 }, [A, B])
    const armOf = (t: number) => evaluateClip([], clip, t).rot.get('arm') ?? [0, 0, 0]
    // From A at 0, to B at half the pass, back to A at the wrap.
    expect(armOf(0)).toEqual([0, 0, 0])
    expect(armOf(2)).toEqual([0, Math.PI / 2, 0])
    for (let i = 0; i < 3; i++) expect(armOf(4)[i]).toBeCloseTo(0, 5)
    // Midway out eases halfway (in-out phase 0.5 slerps half the angle).
    expect(armOf(1)[1]).toBeCloseTo(Math.PI / 4, 5)
    // ... and the way back mirrors the way out.
    expect(armOf(3)[1]).toBeCloseTo(Math.PI / 4, 5)
  })

  it('embeds empty joints for unknown pose ids', () => {
    const clip = clipFromPoseCycle({ fromId: 'ghost', toId: 'b', mode: 'once', speed: 1 }, [A, B])
    expect(clip.keys[0].joints).toEqual({})
  })
})

describe('sampleKeyPayload', () => {
  it('reads a key instant back verbatim (bit-clean, like evaluation)', () => {
    const clip = twoKeyLoop()
    expect(sampleKeyPayload([], clip, 2)).toEqual({ joints: { arm: [0, Math.PI / 2, 0] }, offsets: {} })
  })

  it('freezes a mid-linear-segment blend, so the split reproduces the segment', () => {
    const clip: RigClip = {
      id: 'clip',
      name: 'swing',
      loop: false,
      duration: 2,
      keys: [key('k0', 'A', 0, 'linear'), key('k1', 'B', 2, 'linear', { arm: [0, Math.PI / 2, 0] })],
    }
    const at = 1
    const { joints, offsets } = sampleKeyPayload([], clip, at)
    // Halfway along a linear slerp of a pure-Y swing: half the angle, still pure-Y.
    expect(joints.arm![1]).toBeCloseTo(Math.PI / 4, 10)
    expect(joints.arm![0]).toBeCloseTo(0, 10)
    expect(joints.arm![2]).toBeCloseTo(0, 10)
    expect(offsets).toEqual({})
    // Splitting the segment there reproduces the original curve on both halves.
    const split: RigClip = {
      ...clip,
      keys: [
        key('k0', 'A', 0, 'linear'),
        { id: 'km', name: 'M', time: 1, ease: 'linear', joints },
        key('k1', 'B', 2, 'linear', { arm: [0, Math.PI / 2, 0] }),
      ],
    }
    for (const t of [0.25, 0.5, 1, 1.5, 1.75]) {
      const before = evaluateClip([], clip, t).rot.get('arm')!
      const after = evaluateClip([], split, t).rot.get('arm')!
      expect(after[0]).toBeCloseTo(before[0], 9)
      expect(after[1]).toBeCloseTo(before[1], 9)
      expect(after[2]).toBeCloseTo(before[2], 9)
    }
  })

  it('freezes a hold span at the outgoing pose', () => {
    const clip: RigClip = {
      id: 'clip',
      name: 'step',
      loop: false,
      duration: 2,
      keys: [key('k0', 'A', 0, 'hold', { arm: [0, 0.4, 0] }), key('k1', 'B', 2, 'linear')],
    }
    expect(sampleKeyPayload([], clip, 1).joints).toEqual({ arm: [0, 0.4, 0] })
  })

  it('carries root offsets through the sample', () => {
    const clip: RigClip = {
      id: 'clip',
      name: 'bob',
      loop: false,
      duration: 2,
      keys: [key('k0', 'A', 0, 'linear', {}, { root: [0, 0, 0] }), key('k1', 'B', 2, 'linear', {}, { root: [0, 4, 0] })],
    }
    const boxes = [box('root')]
    const { offsets } = sampleKeyPayload(boxes, clip, 1)
    expect(offsets.root![1]).toBeCloseTo(2, 10)
  })
})

describe('deriveAnimationMode', () => {
  const tweens = [{ id: 'tw', kind: 'rotate', axis: 'y', direction: 1, speed: 1, amount: 4, minAngle: -30, maxAngle: 30, enabled: true } as const]

  it('uses poses when poses exist and no tween is enabled', () => {
    const muted: RigBox[] = [{ ...box('a'), tweens: [{ ...tweens[0], enabled: false }] }]
    expect(deriveAnimationMode({ rigBoxes: muted, poses: [{ id: 'a' }] })).toBe('poses')
    expect(deriveAnimationMode({ rigBoxes: [box('a')], poses: [{ id: 'a' }] })).toBe('poses')
  })

  it('uses tweens when a tween is enabled or when neither system is in use', () => {
    const tweened: RigBox[] = [{ ...box('a'), tweens: [...tweens] }]
    expect(deriveAnimationMode({ rigBoxes: tweened, poses: [{ id: 'a' }] })).toBe('tweens')
    expect(deriveAnimationMode({ rigBoxes: [box('a')], poses: [] })).toBe('tweens')
    expect(deriveAnimationMode({ rigBoxes: [], poses: [] })).toBe('tweens')
  })
})
