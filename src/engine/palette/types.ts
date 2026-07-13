/** A palette slot's kind also selects its **material class** at render/export time (see
 * `materialClassFor` in palette.ts): base → matte, emissive → glowing, metal → polished PBR metal,
 * glass → frosted transmissive. (Replaced the earlier animation-oriented `blink`/`pulse` kinds,
 * which glTF can't represent.) */
export type PaletteSlotKind = 'base' | 'emissive' | 'metal' | 'glass'

export type PaletteSlotRef = {
  kind: PaletteSlotKind
  /** Index within that slot kind's array. */
  index: number
}

export type PaletteState = {
  base: string[] // 16 hex colors
  emissive: string[] // 4 hex colors
  metal: string[] // 4 hex colors (specular tint for polished metals)
  glass: string[] // 4 hex colors (frosted-glass tint)
}
