import type { Axis } from '@/engine/grid/types'

export type AnimationType = 'none' | 'rotate-cw' | 'rotate-ccw' | 'slide-vertical' | 'slide-horizontal'
export type AnimationSpeed = 1 | 2 | 3
export type SliceKey = string

export type SliceAnimSettings = {
  animationType: AnimationType
  speed: AnimationSpeed
  slideAmount: number
}

export type AnimLayer = {
  axis: Axis
  offset: number
  settings: SliceAnimSettings
}
