/**
 * Palette brighten lookup table.
 *
 * Builds a per-palette table that maps every entry in the canonical
 * `paletteToColorArray` flattening into the index of the brightest peer
 * within the same `hueGroup`. Used by atlas-time autotile compositors
 * (e.g. `edge-wall`) that want to brighten an edge pixel while staying
 * inside the active palette.
 *
 * Indexing matches `paletteToColorArray(p)`:
 *   0                                   -> transparent (identity)
 *   1 .. p.colors.length                -> foreground colors
 *   ... + 1 .. + p.backgroundColors     -> background colors (identity)
 *   ... + 1 .. + p.effectColors         -> effect colors (identity)
 *
 * Only foreground entries are remapped. Within a foreground hueGroup the
 * highest palette index wins (by convention, palettes order each group
 * darkest -> brightest). When a color has no peers in its group, the
 * entry maps to itself.
 */
import type { ColorPalette } from './interfaces';

/**
 * Build a brighten LUT for a `ColorPalette`. The returned `Uint8Array`
 * has length `1 + colors + backgroundColors + effectColors`. Index `i`
 * holds the index this slot brightens to (or `i` if no brighter peer
 * exists / the slot is not a foreground color).
 *
 * Pure function. Safe to cache per palette.
 */
export function buildBrightenLUTForPalette(p: ColorPalette): Uint8Array {
  const fgCount = p.colors.length;
  const bgCount = p.backgroundColors.length;
  const fxCount = p.effectColors.length;
  const total = 1 + fgCount + bgCount + fxCount;

  const lut = new Uint8Array(total);
  for (let i = 0; i < total; i++) lut[i] = i;

  // Walk foreground groups in order; within each contiguous run sharing
  // the same hueGroup, every entry's brightened index is the run's last
  // index (highest palette index = brightest).
  let i = 0;
  while (i < fgCount) {
    const group = p.colors[i].hueGroup;
    let end = i;
    while (end + 1 < fgCount && p.colors[end + 1].hueGroup === group) end++;
    const brightestSlot = end + 1; // +1 because slot 0 is transparent
    for (let k = i; k <= end; k++) {
      lut[k + 1] = brightestSlot;
    }
    i = end + 1;
  }

  return lut;
}

/**
 * Build an "edge brighten" LUT for a single source frame in a given
 * palette. The remap target for each foreground slot is the slot one
 * notch brighter than the highest in-`hueGroup` index actually used by
 * `source`, clamped to the group's brightest slot.
 *
 * Examples (group has 4 slots, indices 0..3, brightest = 3):
 *   - source uses {0, 1}    -> all 4 slots in group map to 2
 *   - source uses {0, 1, 2} -> all 4 slots in group map to 3
 *   - source uses {3}       -> all 4 slots map to 3 (clamp)
 *   - source uses none      -> identity (no remap)
 *
 * This produces a softer "one step brighter" edge instead of always
 * jumping to the brightest peer, and lets the sprite author control
 * how much edge glow each design state expresses by which palette
 * indices they pack into the source.
 *
 * Indexing matches `paletteToColorArray(p)`:
 *   0                                -> transparent (identity)
 *   1 .. p.colors.length             -> foreground (may map)
 *   ... + 1 .. + bgCount             -> background (identity)
 *   ... + 1 .. + effectCount         -> effects (identity)
 *
 * Pure. Safe to cache per (source, palette) pair.
 */
export function buildEdgeBrightenLUTForSource(
  source: number[][],
  p: ColorPalette,
): Uint8Array {
  const fgCount = p.colors.length;
  const bgCount = p.backgroundColors.length;
  const fxCount = p.effectColors.length;
  const total = 1 + fgCount + bgCount + fxCount;

  const lut = new Uint8Array(total);
  for (let i = 0; i < total; i++) lut[i] = i;

  // Pass 1: find the highest in-hueGroup palette index actually used by
  // the source. Pixels at slot 0 (transparent) and non-foreground slots
  // (bg/effect) don't participate.
  const maxUsedInGroup = new Map<string, number>();
  for (let y = 0; y < source.length; y++) {
    const row = source[y];
    for (let x = 0; x < row.length; x++) {
      const slot = row[x];
      if (slot <= 0 || slot > fgCount) continue;
      const colorIdx = slot - 1;
      const group = p.colors[colorIdx].hueGroup;
      const prev = maxUsedInGroup.get(group);
      if (prev === undefined || colorIdx > prev) {
        maxUsedInGroup.set(group, colorIdx);
      }
    }
  }

  // Pass 2: for each contiguous foreground hueGroup that the source
  // touches, every slot in that group maps to (maxUsed + 1) clamped to
  // the group's brightest slot. Groups the source doesn't touch keep
  // identity (no remap target needed).
  let i = 0;
  while (i < fgCount) {
    const group = p.colors[i].hueGroup;
    let end = i;
    while (end + 1 < fgCount && p.colors[end + 1].hueGroup === group) end++;
    const maxUsed = maxUsedInGroup.get(group);
    if (maxUsed !== undefined) {
      const targetIdx = Math.min(maxUsed + 1, end); // p.colors index
      const targetSlot = targetIdx + 1;             // sprite slot index
      for (let k = i; k <= end; k++) {
        lut[k + 1] = targetSlot;
      }
    }
    i = end + 1;
  }

  return lut;
}
