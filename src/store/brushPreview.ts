import type { ChamferClassification, Rotation } from '@/engine/grid/types'
import type { VoxelKind } from './types'

/** Preview shape for the brush HUD/ghost: null = plain cube (no chamfer entry). */
export type BrushPreviewShape = { shapeKind: 'ramp' | 'convex' | 'concave' | 'wedge' | 'thin' | 'half' | 'post' | 'quarter' | 'flat' | 'flatwedge'; rotation: Rotation }

/**
 * Resolves what the brush will paint, for previews (ghost + HUD mini-renderer).
 * `auto` is the live autotile verdict at the placement cell (ramp/wedge only) — null when the
 * resolver can't classify yet (renders/stays a cube for ramp; wedge falls back to rotation 0).
 * `brush` is the manual R-rotation offset, applied additively so 0 = legacy behavior exactly.
 * Mirrors `applyPaintCell`'s fresh-paint branches in `paintActions.ts` — keep them in sync.
 */
export function resolveBrushPreview(
  kind: VoxelKind,
  brush: Rotation,
  auto: ChamferClassification | null,
): BrushPreviewShape | null {
  switch (kind) {
    case 'cube':
      return null
    case 'ramp':
      if (!auto || (auto.shapeKind !== 'ramp' && auto.shapeKind !== 'convex' && auto.shapeKind !== 'concave')) return null
      return { shapeKind: auto.shapeKind, rotation: ((auto.rotation + brush) % 4) as Rotation }
    case 'wedge':
      return { shapeKind: 'wedge', rotation: (((auto?.shapeKind === 'convex' ? auto.rotation : 0) + brush) % 4) as Rotation }
    case 'convex':
    case 'concave':
    case 'quarter':
    case 'flatwedge':
      return { shapeKind: kind, rotation: brush }
    case 'thin':
    case 'half':
    case 'post':
    case 'flat':
      return { shapeKind: kind, rotation: 0 }
  }
}
