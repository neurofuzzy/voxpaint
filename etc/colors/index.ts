export type ColorPalette = import('./interfaces').ColorPalette;
export * from './brighten-lut';
export * from './adventure';
export * from './alchemy';
export * from './bronze-age';
export * from './crt';
export * from './hellscape';
export * from './iron-age';
export * from './neon-arcade';
export * from './ocean';
export * from './printmaker';
export * from './retro-console';
export * from './roguelike';
export * from './sahara';
export * from './sploder';
export * from './sprouts';
export * from './starfarer';
export * from './sweetie';

// Import all palettes for PRESET_PALETTES array
import { ADVENTURE } from './adventure';
import { ALCHEMIST_TROVE } from './alchemy';
import { BRONZE_AGE } from './bronze-age';
import { CRT } from './crt';
import { INFERNAL_ABYSS } from './hellscape';
import { IRON_AGE } from './iron-age';
import { NEON_ARCADE } from './neon-arcade';
import { DEEP_COLONIZER } from './ocean';
import { PRINTMAKER } from './printmaker';
import { RETRO_CONSOLE } from './retro-console';
import { ROGUELIKE } from './roguelike';
import { SAHARA_CONVOY } from './sahara';
import { SPLODER_DEFAULT } from './sploder';
import { SPROUTS_AND_STALKS } from './sprouts';
import { STARFARER } from './starfarer';
import { SWEETIE } from './sweetie';

/**
 * Array of all available color palettes.
 * Used by applications like the sprite editor for palette selection.
 */
export const PRESET_PALETTES: ColorPalette[] = [
    SPLODER_DEFAULT,
    RETRO_CONSOLE,
    NEON_ARCADE,
    SWEETIE,
    CRT,
    ROGUELIKE,
    ADVENTURE,
    ALCHEMIST_TROVE,
    BRONZE_AGE,
    INFERNAL_ABYSS,
    IRON_AGE,
    DEEP_COLONIZER,
    PRINTMAKER,
    SAHARA_CONVOY,
    SPROUTS_AND_STALKS,
    STARFARER,
];
