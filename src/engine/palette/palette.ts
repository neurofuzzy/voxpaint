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
