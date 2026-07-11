import type { PaletteSlotRef, PaletteState, PaletteSlotKind } from './types'

export const PALETTE_SLOT_COUNTS: Record<PaletteSlotKind, number> = {
  base: 16,
  emissive: 4,
  blink: 4,
  pulse: 4,
}

/** Emissive "class" id consumed by the shared instanced shader (0 = none). */
export function emissiveClassFor(kind: PaletteSlotKind): 0 | 1 | 2 | 3 {
  switch (kind) {
    case 'base':
      return 0
    case 'emissive':
      return 1
    case 'blink':
      return 2
    case 'pulse':
      return 3
  }
}

export function resolveSlotColor(palette: PaletteState, slot: PaletteSlotRef): string {
  const arr = palette[slot.kind]
  return arr[slot.index] ?? '#ff00ff' // fallback: obvious magenta if a slot ref is stale/out of range
}

export function isValidSlotRef(slot: PaletteSlotRef): boolean {
  return slot.index >= 0 && slot.index < PALETTE_SLOT_COUNTS[slot.kind]
}

/** Shifts a `#rrggbb` color's RGB channels by a flat delta (clamped to [0,255]) — a quick additive
 * tint/shade, not a perceptual HSL adjustment, but enough for "slightly darker/lighter" variants. */
export function shadeColor(hex: string, delta: number): string {
  const clean = hex.replace('#', '')
  const channel = (offset: number) => {
    const value = Math.min(255, Math.max(0, parseInt(clean.slice(offset, offset + 2), 16) + delta))
    return Math.round(value).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(2)}${channel(4)}`
}
