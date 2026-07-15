import type { PaletteSlotRef, PaletteState, PaletteSlotKind } from './types'

export const PALETTE_SLOT_COUNTS: Record<PaletteSlotKind, number> = {
  base: 16,
  emissive: 4,
  metal: 4,
  glass: 4,
}

/** The PBR material archetype a palette slot renders/exports as. Mirrors the palette's slot kinds:
 * base → matte, emissive → glowing, metal → polished metal, glass → frosted transmissive. */
export type MaterialClass = 'matte' | 'emissive' | 'metal' | 'glass'

/** Maps a palette slot kind to its material class (the render/export archetype). */
export function materialClassFor(kind: PaletteSlotKind): MaterialClass {
  switch (kind) {
    case 'base':
      return 'matte'
    case 'emissive':
      return 'emissive'
    case 'metal':
      return 'metal'
    case 'glass':
      return 'glass'
  }
}

/** PBR parameters fed to `MeshPhysicalMaterial` (preview) and the glTF export material for a class.
 * Ranges follow `etc/specs/gltf-materials-maps.md` §3; single representative values are chosen here.
 * The slot's palette hex supplies the base color (specular tint for metal, absorption tint for glass). */
export type MaterialParams = {
  metalness: number
  roughness: number
  transmission: number
  /** >0 only for the emissive class; the slot color also becomes `material.emissive`. */
  emissiveIntensity: number
}

export function materialParamsFor(cls: MaterialClass): MaterialParams {
  switch (cls) {
    case 'matte':
      return { metalness: 0, roughness: 0.6, transmission: 0, emissiveIntensity: 0 }
    case 'emissive':
      return { metalness: 0, roughness: 0.5, transmission: 0, emissiveIntensity: 1.5 }
    case 'metal':
      return { metalness: 1, roughness: 0.2, transmission: 0, emissiveIntensity: 0 }
    case 'glass':
      return { metalness: 0, roughness: 0.5, transmission: 1, emissiveIntensity: 0 }
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

/** Rec. 601 luma of a `#rrggbb` hex string — cheap "how dark is this" ordering, not a perceptual model. */
function luma(hex: string): number {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** The darkest swatch in the base (matte) palette — used as the "off" color for a blinking/pulsing
 * emissive material, so a dimmed light reads as an ordinary unlit surface (matching the model's own
 * shadow tone) instead of fading to pure black. */
export function darkestBaseColor(palette: PaletteState): string {
  return palette.base.reduce((darkest, hex) => (luma(hex) < luma(darkest) ? hex : darkest), palette.base[0])
}
