#!/usr/bin/env npx tsx
/**
 * Generates src/engine/palette/themes.ts from a curated subset of the reference color palettes in
 * etc/colors/ (see INCLUDED_IDS), plus fully hand-authored themes with no etc/colors source at all
 * (see CUSTOM_THEMES, appended after the derived ones).
 *
 * `base` (16 slots) is built by taking the 2nd and 4th shade (upper-mid and brightest) from EVERY
 * hue-group available — first each group in `colors`, then each group in `backgroundColors` —
 * favoring more distinct hues over more shades of the same hue (the 3D view's own lighting provides
 * shading variation, so the palette doesn't need to pre-bake full 4-step ramps). A group too short
 * to have a "2nd"/"4th" (e.g. iron-age's ungrouped single-color backgroundColors) falls back to its
 * only shade. If still short of 16 (palettes with few hue-groups), pads with each color-group's
 * remaining shades (1st, then 3rd) in group order. Exactly 16 either way (`slice(0, 16)` trims any
 * overshoot).
 *
 * `metal` and `glass` are NOT mechanically derived — a source palette has no metal/glass concept,
 * and early mechanical attempts (a leftover hue-group for metal, raw backgroundColors for glass)
 * produced same-hue "metal" and near-black "glass" that didn't read as either material. Both are
 * hand-authored per theme below: metals get genuine hue variety (not just one tinted ramp), glass
 * gets saturated, actually-colored translucent tones.
 *
 * Usage: npx tsx scripts/generate-palette-themes.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { PRESET_PALETTES, type ColorPalette } from '../etc/colors/index'
import type { PaletteState } from '../src/engine/palette/types'

type PaletteTheme = { id: string; name: string; palette: PaletteState }

// Only these themes, in this order (plus the app's own hand-tuned DEFAULT_PALETTE, prepended
// separately in the UI — see components/panels/PaletteThemeMenu.tsx).
const INCLUDED_IDS = ['sploder-default', 'roguelike', 'iron-age', 'deep_colonizer', 'sprouts-stalks']

/** Display-name overrides — the source etc/colors/ name doesn't always read well in this app. */
const NAME_OVERRIDES: Record<string, string> = {
  'sploder-default': 'Neon',
}

/**
 * Fully hand-authored themes — not derived from etc/colors/ at all, appended after the derived
 * themes above. `base` is 8 blackbody colors (a physical heat-temperature ramp: near-black ember
 * through red/orange/yellow to white-hot) followed by 8 complementary colors on the opposite side
 * of the wheel (dark blue through cyan to near-white), the same dark-to-bright progression mirrored
 * in hue — a coherent "fire and ice" 16-swatch spread.
 */
const CUSTOM_THEMES: PaletteTheme[] = [
  {
    id: 'blackbody',
    name: 'Blackbody',
    palette: {
      base: [
        // blackbody: ember -> red -> orange -> yellow -> white-hot
        '#1a0800', '#4d0f00', '#8a1f00', '#c93d00', '#e86a00', '#f5a623', '#ffd166', '#fff4e0',
        // complementary: near-black blue -> deep blue -> teal -> cyan -> near-white cyan
        '#00050d', '#001a33', '#003355', '#005577', '#007a99', '#00a3b8', '#33ccdd', '#b3f5ff',
      ],
      emissive: ['#fff2cc', '#ff3b1f', '#33f2ff', '#5a8cff'], // white-hot, red-hot, cyan glow, blue glow
      metal: ['#ff7b3f', '#3fa9d9', '#2b2b2e', '#c9c9c9'], // molten steel, frost titanium, tungsten, platinum
      glass: ['#ff5a2e', '#ffcc33', '#2ed9ff', '#1a3fff'], // ember, amber, ice, deep blue
      emissiveAnim: ['none', 'none', 'none', 'none'],
    },
  },
]

/** Hand-authored metal/glass per theme — see the file-level doc comment for why these aren't derived. */
const MATERIALS: Record<string, { metal: string[]; glass: string[] }> = {
  'sploder-default': {
    metal: ['#5a6670', '#c9a227', '#8a4a2e', '#d8dce0'], // gunmetal, brass, scorched copper, quicksilver
    glass: ['#7fff3f', '#ff5a1f', '#3fe0ff', '#ff3fc4'], // acid green, magma orange, cavern cyan, toxic magenta
  },
  roguelike: {
    metal: ['#8a8f94', '#a67c3d', '#4a4e57', '#6b5433'], // tarnished silver, aged bronze, dark steel, dull iron
    glass: ['#3fae5c', '#3f7fbf', '#d99a3f', '#b23f4a'], // emerald potion, sapphire, amber ale, ruby
  },
  'iron-age': {
    metal: ['#3d3d3f', '#9c6b34', '#5a8a72', '#8a97a3'], // dark iron, warm bronze, patina copper, polished steel
    glass: ['#c48a3f', '#3f6b4a', '#3f5a8a', '#7a3040'], // amber bottle, forest green, deep blue, wine red
  },
  deep_colonizer: {
    metal: ['#c8d4d8', '#2e3a42', '#4a8f7a', '#a67a4a'], // titanium, dark gunmetal, bio-copper, amber bronze
    glass: ['#3fd9c4', '#6b3fbf', '#d98a3f', '#ff6b9c'], // glowing cyan, deep purple, amber warning, coral pink
  },
  'sprouts-stalks': {
    metal: ['#c9d9c9', '#d9b04a', '#7a8f5a', '#a06b45'], // dew silver, honey gold, mossy bronze, bark copper
    glass: ['#f2d94a', '#c4425a', '#7ec8e0', '#5cae5c'], // sunflower, berry, dew blue, leaf green
  },
}

/** Splits a hueGroup-tagged array into contiguous same-hueGroup runs, preserving order. */
function collectGroups(entries: Array<{ hex: string; hueGroup: string }>): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  let currentName: string | null = null
  for (const e of entries) {
    if (e.hueGroup !== currentName) {
      if (current.length) groups.push(current)
      current = []
      currentName = e.hueGroup
    }
    current.push(e.hex)
  }
  if (current.length) groups.push(current)
  return groups
}

/** 2nd (index 1) and 4th (index 3) shade of each group — "more hue groups, less shades". A group
 * too short to have a "2nd" falls back to its only shade (index 0). */
function pick2nd4th(groups: string[][]): string[] {
  const out: string[] = []
  for (const g of groups) {
    out.push(g.length > 1 ? g[1] : g[0])
    if (g.length > 3) out.push(g[3])
  }
  return out
}

function deriveBase(source: ColorPalette): string[] {
  const colorGroups = collectGroups(source.colors)
  const bgGroups = collectGroups(source.backgroundColors)
  const picked = [...pick2nd4th(colorGroups), ...pick2nd4th(bgGroups)]

  // Rare fallback for palettes with few hue-groups: pad with each color-group's remaining shades.
  for (const shadeIndex of [0, 2]) {
    if (picked.length >= 16) break
    for (const g of colorGroups) {
      if (picked.length >= 16) break
      const shade = g[shadeIndex]
      if (shade && !picked.includes(shade)) picked.push(shade)
    }
  }

  if (picked.length < 16) throw new Error(`${source.id}: only derived ${picked.length}/16 base colors`)
  return picked.slice(0, 16)
}

function toPaletteState(source: ColorPalette): PaletteState {
  const materials = MATERIALS[source.id]
  if (!materials) throw new Error(`${source.id}: no hand-authored metal/glass in MATERIALS`)
  if (source.effectColors.length !== 4) throw new Error(`${source.id}: expected exactly 4 effectColors, got ${source.effectColors.length}`)

  return {
    base: deriveBase(source),
    metal: materials.metal,
    glass: materials.glass,
    emissive: [...source.effectColors],
    emissiveAnim: ['none', 'none', 'none', 'none'],
  }
}

const hexArray = (hexes: string[]) => `[${hexes.map((h) => `'${h}'`).join(', ')}]`

function themeLiteral(theme: PaletteTheme): string {
  const p = theme.palette
  return `  {
    id: ${JSON.stringify(theme.id)},
    name: ${JSON.stringify(theme.name)},
    palette: {
      base: ${hexArray(p.base)},
      emissive: ${hexArray(p.emissive)},
      metal: ${hexArray(p.metal)},
      glass: ${hexArray(p.glass)},
      emissiveAnim: ['none', 'none', 'none', 'none'],
    },
  }`
}

const header = `import type { PaletteState } from './types'

/**
 * Pre-made themed palettes, generated from a curated subset of etc/colors/ by
 * scripts/generate-palette-themes.ts — do not hand-edit; re-run the script instead. \`base\` favors
 * hue-group variety over shade ramps (2nd + 4th shade of each available hue-group); \`metal\`/\`glass\`
 * are hand-authored per theme (see the script's MATERIALS table) for genuine material variety —
 * see the script's doc comment for the full rationale.
 */
export type PaletteTheme = { id: string; name: string; palette: PaletteState }

export const PALETTE_THEMES: PaletteTheme[] = [
`

const derivedThemes: PaletteTheme[] = INCLUDED_IDS.map((id) => {
  const source = PRESET_PALETTES.find((p) => p.id === id)
  if (!source) throw new Error(`No preset palette with id ${id}`)
  return { id: source.id, name: NAME_OVERRIDES[source.id] ?? source.name, palette: toPaletteState(source) }
})

const allThemes = [...derivedThemes, ...CUSTOM_THEMES]

const body = allThemes.map(themeLiteral).join(',\n')
const footer = `,
]
`

const out = header + body + footer
const outPath = path.join(process.cwd(), 'src/engine/palette/themes.ts')
fs.writeFileSync(outPath, out)
console.log(`Wrote ${outPath} (${allThemes.length} themes: ${derivedThemes.length} derived + ${CUSTOM_THEMES.length} custom)`)
