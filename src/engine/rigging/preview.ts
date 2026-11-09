import * as THREE from 'three'
import { evaluateClip } from './clip'
import { composePoseMatrices, type JointEuler } from './pose'
import { composeTweenMatrices } from './rigLoop'
import type { Coord } from '@/engine/grid/types'
import type { AnimationMode, RigBox, RigClip } from './types'

/**
 * Everything the store holds that decides the animated frame: the project's mode, the
 * outline, the keyframe clips, the transport, and the selected key. The store passes
 * itself straight in (it already holds every field — the mode lives on `meta`, like
 * everywhere else it is read).
 */
export type PreviewInput = {
  meta: { animationMode?: AnimationMode }
  rigBoxes: RigBox[]
  clips: RigClip[]
  activeClipId: string | null
  /** Key under edit — its joints drive the preview when the transport is off it. */
  selectedKeyId: string | null
  clipPlaying: boolean
  clipStartedAt: number
  /** Null = off the timeline: the preview shows the selected key (bind with none).
   * A number = the paused/scrubbed playhead (seconds, clip-local). */
  clipTime: number | null
}

/**
 * One evaluated animation instant: the composed world matrix per box, the joint
 * rotations that produced it (empty in tweens mode — poses never evaluate there),
 * and the root translation offsets in voxels (empty likewise; sparse like the key).
 */
export type PreviewFrame = {
  worlds: Map<string, THREE.Matrix4>
  pose: Map<string, JointEuler>
  off: Map<string, Coord>
}

/**
 * The single choke point for every animated viewport consumer (voxel meshes, wire
 * outlines, pivot markers, parent→child links, pose rings, gizmo drags): one call maps
 * the store to the frame every chrome agrees on, so the model can never disagree with
 * its outlines about where a joint is.
 *
 * Tweens mode composes only the tween stacks (`composeTweenMatrices`). Poses mode
 * composes only the posed chain (`composePoseMatrices`) — tweens never evaluate,
 * anywhere: the playing clip's frame while transport runs, the paused or scrubbed
 * (`clipTime`, a number) frame while on the timeline, else the selected keyframe's
 * joints, else bind (empty map).
 */
export function previewFrame(state: PreviewInput, nowSeconds: number): PreviewFrame {
  if ((state.meta.animationMode ?? 'tweens') === 'tweens') {
    return { worlds: composeTweenMatrices(state.rigBoxes, nowSeconds), pose: new Map(), off: new Map() }
  }
  const clip = state.clips.find((c) => c.id === state.activeClipId) ?? null
  if (clip && clip.keys.length > 0 && (state.clipPlaying || state.clipTime !== null)) {
    const t = state.clipPlaying ? nowSeconds - state.clipStartedAt : (state.clipTime ?? 0)
    const frame = evaluateClip(state.rigBoxes, clip, t)
    return { worlds: composePoseMatrices(state.rigBoxes, frame.rot, frame.off), pose: frame.rot, off: frame.off }
  }
  const selected = clip?.keys.find((k) => k.id === state.selectedKeyId)
  const roots = new Set<string>()
  for (const b of state.rigBoxes) if (b.parentId == null) roots.add(b.id)
  const pose = new Map(Object.entries(selected?.joints ?? {})) as Map<string, JointEuler>
  // Key offsets evaluate roots-only (see evaluateClip) — filter the same way so the
  // selected-key preview agrees with the playing clip exactly.
  const off = new Map<string, Coord>()
  for (const [id, o] of Object.entries(selected?.offsets ?? {})) {
    if (roots.has(id)) off.set(id, [o[0], o[1], o[2]])
  }
  return { worlds: composePoseMatrices(state.rigBoxes, pose, off), pose, off }
}
