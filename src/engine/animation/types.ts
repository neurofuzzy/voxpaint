import type { Axis } from '@/engine/grid/types'

export type AnimationType =
  | 'none'
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'slide-vertical'
  | 'slide-vertical-rev'
  | 'slide-horizontal'
  | 'slide-horizontal-rev'
  | 'pendulum'
  | 'pendulum-rev'
export type AnimationSpeed = 1 | 2 | 3
export type SliceKey = string

export type SliceAnimSettings = {
  animationType: AnimationType
  speed: AnimationSpeed
  slideAmount: number
  /** Pendulum swing amplitude in degrees (5-90). Unused by other animation types. */
  swingAmount: number
}

export type AnimLayer = {
  axis: Axis
  offset: number
  settings: SliceAnimSettings
}
