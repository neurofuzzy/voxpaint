import * as THREE from 'three'
import type { EmissiveAnimMode, PaletteState } from './types'

/** Blink/pulse both cycle once per second, live-previewed and exported alike. */
export const EMISSIVE_ANIM_CYCLE_SECONDS = 1

const colorToKey = new THREE.Color()

/** Maps each animated emissive slot's resolved color-int to its animation mode, so render code that
 * only knows a group's `colorKey` (not which palette slot it came from) can still look up its mode.
 * Slots left at 'none' are omitted. Duplicate colors across slots resolve to whichever slot is later
 * in the array — a harmless ambiguity since identical colors are visually indistinguishable anyway. */
export function buildEmissiveAnimIndex(palette: PaletteState): Map<number, EmissiveAnimMode> {
  const index = new Map<number, EmissiveAnimMode>()
  const modes = palette.emissiveAnim
  for (let i = 0; i < palette.emissive.length; i++) {
    const mode = modes?.[i] ?? 'none'
    if (mode === 'none') continue
    index.set(colorToKey.set(palette.emissive[i]).getHex(), mode)
  }
  return index
}

/** 0..1 intensity multiplier at `elapsedSeconds` for the live preview. 'blink' hard-steps at the
 * half-cycle; 'pulse' is a smooth raised-cosine breathe — `(1 - cos(ωt)) / 2`, zero derivative at
 * both the trough (t=0) and peak (t=T/2), so it loops without a visible seam. Mirrors (but is
 * independent of) the CUBICSPLINE keyframes baked for glTF export in `emissiveAnimationExport.ts`. */
export function emissiveAnimFactor(mode: EmissiveAnimMode, elapsedSeconds: number): number {
  const phase = ((elapsedSeconds % EMISSIVE_ANIM_CYCLE_SECONDS) + EMISSIVE_ANIM_CYCLE_SECONDS) % EMISSIVE_ANIM_CYCLE_SECONDS
  if (mode === 'blink') {
    return phase < EMISSIVE_ANIM_CYCLE_SECONDS / 2 ? 1 : 0
  }
  if (mode === 'pulse') {
    const omega = (2 * Math.PI) / EMISSIVE_ANIM_CYCLE_SECONDS
    return (1 - Math.cos(omega * phase)) / 2
  }
  return 1
}
