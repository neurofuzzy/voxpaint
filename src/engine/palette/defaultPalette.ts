import type { PaletteState } from './types'

/** Slightly desaturated "vintage retro" default palette. Fully user-editable at runtime. */
export const DEFAULT_PALETTE: PaletteState = {
  base: [
    '#d8d4dc', // off white
    '#a79eb1', // pale lilac gray
    '#746b7e', // dusty lavender gray
    '#41374c', // muted violet-gray
    '#141117', // near-black plum
    '#8a5a44', // muted terracotta
    '#c98a5c', // dusty orange
    '#d99d68', // muted gold, touch of red
    '#8a9b5c', // sage green
    '#5c8a6e', // muted teal green
    '#4a7a8a', // dusty teal blue
    '#4a5f8a', // muted indigo
    '#6b4a8a', // muted purple
    '#8a4a6b', // muted mauve
    '#b0555a', // dusty brick red
    '#c8b493', // sand
  ],
  emissive: ['#ff6b4a', '#4ad9ff', '#b04aff', '#7aff6b'],
  metal: ['#f0f0f0', '#ffe17d', '#c69269', '#f1967a'], // silver, gold, bronze, copper
  glass: ['#9aa0a6', '#5a86c9', '#d9a441', '#5aa06e'], // gray, blue, amber, green
  emissiveAnim: ['none', 'none', 'none', 'none'],
}
