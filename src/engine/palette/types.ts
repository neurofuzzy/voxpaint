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

/** Per-emissive-slot glow animation, both live-previewed (R3F, all modes) and baked into glTF
 * export via `KHR_animation_pointer` on `KHR_materials_emissive_strength.emissiveStrength` (see
 * `engine/export/emissiveAnimationExport.ts`) — unlike the old (pre-material-class-redesign)
 * `blink`/`pulse` slot kinds, this really is exportable, since the animation now targets a material
 * property pointer instead of needing a dedicated glTF channel type. 1Hz cycle either way.
 * 'blink' = hard STEP on/off; 'pulse' = smooth raised-cosine breathing. */
export type EmissiveAnimMode = 'none' | 'blink' | 'pulse'

export type PaletteState = {
  base: string[] // 16 hex colors
  emissive: string[] // 4 hex colors
  metal: string[] // 4 hex colors (specular tint for polished metals)
  glass: string[] // 4 hex colors (frosted-glass tint)
  /** Animation mode per emissive slot, index-aligned with `emissive`. */
  emissiveAnim: EmissiveAnimMode[]
}
