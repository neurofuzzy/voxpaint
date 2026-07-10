import type { ChamferShapeKind, Rotation } from '@/engine/grid/types'

export type NeighborSample = {
  N: boolean
  E: boolean
  S: boolean
  W: boolean
  NE: boolean
  SE: boolean
  SW: boolean
  NW: boolean
}

export type ChamferClassification = {
  shapeKind: ChamferShapeKind
  rotation: Rotation
}
