import type { PaletteState } from './types'

/**
 * Pre-made themed palettes, generated from a curated subset of etc/colors/ by
 * scripts/generate-palette-themes.ts — do not hand-edit; re-run the script instead. `base` favors
 * hue-group variety over shade ramps (2nd + 4th shade of each available hue-group); `metal`/`glass`
 * are hand-authored per theme (see the script's MATERIALS table) for genuine material variety —
 * see the script's doc comment for the full rationale.
 */
export type PaletteTheme = { id: string; name: string; palette: PaletteState }

export const PALETTE_THEMES: PaletteTheme[] = [
  {
    id: "sploder-default",
    name: "Neon",
    palette: {
      base: ['#4CC02F', '#C2FF9D', '#168791', '#65FEFF', '#A7177B', '#FF6CE2', '#C25B12', '#FFC067', '#A33414', '#FF8866', '#8D9DA0', '#CEDEDF', '#192325', '#3D4D50', '#2C1B17', '#593D37'],
      emissive: ['#dd0000', '#ff3300', '#ff9900', '#eecc00'],
      metal: ['#5a6670', '#c9a227', '#8a4a2e', '#d8dce0'],
      glass: ['#7fff3f', '#ff5a1f', '#3fe0ff', '#ff3fc4'],
      emissiveAnim: ['none', 'none', 'none', 'none'],
    },
  },
  {
    id: "roguelike",
    name: "Roguelike",
    palette: {
      base: ['#316842', '#375832', '#373984', '#54a4cc', '#8c7b65', '#c4b89c', '#9a3117', '#b8640b', '#A09D9D', '#DFDEDE', '#252520', '#3d3d38', '#302418', '#4a3828', '#2a5536', '#2a2d6a'],
      emissive: ['#ff9c18', '#f8f0d8', '#88d4ff', '#d8c098'],
      metal: ['#8a8f94', '#a67c3d', '#4a4e57', '#6b5433'],
      glass: ['#3fae5c', '#3f7fbf', '#d99a3f', '#b23f4a'],
      emissiveAnim: ['none', 'none', 'none', 'none'],
    },
  },
  {
    id: "iron-age",
    name: "Iron Age",
    palette: {
      base: ['#4d6957', '#7ba488', '#3d5370', '#6e8bab', '#5c3e30', '#9d6e58', '#7d3d2a', '#c66e52', '#54615c', '#8d9c95', '#2a2218', '#1e2432', '#281e2d', '#1e2a2c', '#28282a', '#2d251e'],
      emissive: ['#ff9c78', '#b4ffc8', '#a8c8ff', '#f89c7c'],
      metal: ['#3d3d3f', '#9c6b34', '#5a8a72', '#8a97a3'],
      glass: ['#c48a3f', '#3f6b4a', '#3f5a8a', '#7a3040'],
      emissiveAnim: ['none', 'none', 'none', 'none'],
    },
  },
  {
    id: "deep_colonizer",
    name: "Deep Colonizer",
    palette: {
      base: ['#2E4E35', '#7AA884', '#1A4D53', '#56B4BF', '#153A57', '#478ABF', '#353258', '#8C87C7', '#57462B', '#BF9B6A', '#081229', '#122440', '#0C1515', '#182828', '#1B2D1F', '#0E2A2E'],
      emissive: ['#ff88d4', '#e884ff', '#8cffe0', '#ffb878'],
      metal: ['#c8d4d8', '#2e3a42', '#4a8f7a', '#a67a4a'],
      glass: ['#3fd9c4', '#6b3fbf', '#d98a3f', '#ff6b9c'],
      emissiveAnim: ['none', 'none', 'none', 'none'],
    },
  },
  {
    id: "sprouts-stalks",
    name: "Sprouts and Stalks",
    palette: {
      base: ['#3D8A50', '#7DCB90', '#889C35', '#DFFC60', '#497A7C', '#88D2D5', '#5B7E5C', '#9FBDA0', '#A15B3E', '#EC9B6D', '#2C3E2C', '#516751', '#2C2F45', '#51557A', '#206B33', '#5E6B1F'],
      emissive: ['#fff498', '#98ffcc', '#ffb888', '#98f0ff'],
      metal: ['#c9d9c9', '#d9b04a', '#7a8f5a', '#a06b45'],
      glass: ['#f2d94a', '#c4425a', '#7ec8e0', '#5cae5c'],
      emissiveAnim: ['none', 'none', 'none', 'none'],
    },
  },
  {
    id: "blackbody",
    name: "Blackbody",
    palette: {
      base: ['#1a0800', '#4d0f00', '#8a1f00', '#c93d00', '#e86a00', '#f5a623', '#ffd166', '#fff4e0', '#00050d', '#001a33', '#003355', '#005577', '#007a99', '#00a3b8', '#33ccdd', '#b3f5ff'],
      emissive: ['#fff2cc', '#ff3b1f', '#33f2ff', '#5a8cff'],
      metal: ['#ff7b3f', '#3fa9d9', '#2b2b2e', '#c9c9c9'],
      glass: ['#ff5a2e', '#ffcc33', '#2ed9ff', '#1a3fff'],
      emissiveAnim: ['none', 'none', 'none', 'none'],
    },
  },
]
