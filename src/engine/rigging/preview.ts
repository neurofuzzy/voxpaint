import * as THREE from 'three'
import { evaluateClip } from './clip'
import { composePoseMatrices, type JointEuler } from './pose'
import { composeTweenMatrices } from './rigLoop'
import type { AnimationMode, Pose, RigBox, RigClip } from './types'

/**
 * Everything the store holds that decides the animated frame: the project's mode, the
 * outline, the pose library and clips, the clip transport, and the gizmo scratch/staging.
 * The store passes itself straight in (it already holds every field — the mode lives on
 * `meta`, like everywhere else it is read).
 */
export type PreviewInput = {
  meta: { animationMode?: AnimationMode }
  rigBoxes: RigBox[]
  poses: Pose[]
  clips: RigClip[]
  activeClipId: string | null
  clipPlaying: boolean
  clipStartedAt: number
  /** Null = off the timeline: the preview shows the staged pose or scratch. A number =
   * the paused/scrubbed playhead (seconds, clip-local). */
  clipTime: number | null
  stagedPoseId: string | null
  poseRotations: Map<string, JointEuler>
}

/**
 * One evaluated animation instant: the composed world matrix per box plus the joint
 * rotations that produced it (empty in tweens mode — poses never evaluate there).
 */
export type PreviewFrame = {
  worlds: Map<string, THREE.Matrix4>
  pose: Map<string, JointEuler>
}

/**
 * The single choke point for every animated viewport consumer (voxel meshes, wire
 * outlines, pivot markers, parent→child links, pose rings, gizmo drags): one call maps
 * the store to the frame every chrome agrees on, so the model can never disagree with
 * its outlines about where a joint is.
 *
 * Tweens mode composes only the tween stacks (`composeTweenMatrices`) — poses never
 * evaluate, not even staged ones. Poses mode composes only the posed chain
 * (`composePoseMatrices`) — tweens never evaluate, anywhere: the playing clip's frame
 * while transport runs, the paused or scrubbed (`clipTime`, a number) frame while on
 * the timeline, else the staged snapshot, else the live gizmo scratch.
 */
export function previewFrame(state: PreviewInput, nowSeconds: number): PreviewFrame {
  if ((state.meta.animationMode ?? 'tweens') === 'tweens') {
    return { worlds: composeTweenMatrices(state.rigBoxes, nowSeconds), pose: new Map() }
  }
  const clip = state.clips.find((c) => c.id === state.activeClipId) ?? null
  if (clip && clip.keys.length > 0 && (state.clipPlaying || state.clipTime !== null)) {
    const t = state.clipPlaying ? nowSeconds - state.clipStartedAt : (state.clipTime ?? 0)
    const frame = evaluateClip(state.poses, state.rigBoxes, clip, t)
    return { worlds: composePoseMatrices(state.rigBoxes, frame.rot), pose: frame.rot }
  }
  const staged = state.stagedPoseId ? state.poses.find((p) => p.id === state.stagedPoseId) : undefined
  const pose = staged
    ? (new Map(Object.entries(staged.joints)) as Map<string, JointEuler>)
    : state.poseRotations
  return { worlds: composePoseMatrices(state.rigBoxes, pose), pose: new Map(pose) }
}
