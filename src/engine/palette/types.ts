export type PaletteSlotKind = 'base' | 'emissive' | 'blink' | 'pulse'

export type PaletteSlotRef = {
  kind: PaletteSlotKind
  /** Index within that slot kind's array. */
  index: number
}

export type PaletteState = {
  base: string[] // 16 hex colors
  emissive: string[] // 4 hex colors
  blink: string[] // 4 hex colors
  pulse: string[] // 4 hex colors
}
