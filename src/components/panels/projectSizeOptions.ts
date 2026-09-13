import type { GridExtent } from '@/engine/grid/types'

export const SIZE_OPTIONS: Array<{ extent: GridExtent; label: string }> = [
  { extent: 8, label: 'Small' },
  { extent: 16, label: 'Medium' },
  { extent: 24, label: 'Large' },
]

/** Inclusive range for a custom cube size. Odd values are allowed — internally they use the next
 * even grid, framed so the center column reads centered (see engine/grid/GridStore `effectiveExtent`
 * / `viewOriginShift`). Upper bound kept well under the technical `MAX_GRID_EXTENT` for performance. */
export const CUSTOM_MIN = 2
export const CUSTOM_MAX = 48

export function parseCustomSize(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null
  const n = Number(text)
  return n >= CUSTOM_MIN && n <= CUSTOM_MAX ? n : null
}
