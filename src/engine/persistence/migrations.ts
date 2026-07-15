import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { CURRENT_SCHEMA_VERSION, type VoxPaintProjectFile } from './schema'

type Migration = (json: any) => any

/**
 * Ordered, one-step-per-version migration chain: `MIGRATIONS[v]` upgrades a `schemaVersion === v`
 * doc to `v + 1`. v1 → v2 just stamps the new version — the `texture` field is optional, so a v1
 * project simply loads with no texture (an empty one is supplied at deserialize time).
 */
const MIGRATIONS: Migration[] = []
MIGRATIONS[1] = (doc) => ({ ...doc, schemaVersion: 2 })

/**
 * v2 → v3: the palette's animation-oriented `blink`/`pulse` groups became the material groups
 * `metal`/`glass`. Reshape the stored palette (keep base/emissive; drop blink/pulse hex; seed
 * metal/glass from the current defaults) and remap any cell that referenced a `blink`/`pulse` slot
 * to the nearest surviving "glow" concept, `emissive` (index clamped to that group's 0–3 range).
 */
MIGRATIONS[2] = (doc) => {
  const oldPalette = doc.palette ?? {}
  const palette = {
    base: oldPalette.base ?? DEFAULT_PALETTE.base,
    emissive: oldPalette.emissive ?? DEFAULT_PALETTE.emissive,
    metal: DEFAULT_PALETTE.metal,
    glass: DEFAULT_PALETTE.glass,
  }
  const emissiveCount = palette.emissive.length
  const remapSlot = (slot: any) => {
    if (slot && (slot.kind === 'blink' || slot.kind === 'pulse')) {
      return { kind: 'emissive', index: Math.min(Math.max(0, slot.index ?? 0), emissiveCount - 1) }
    }
    return slot
  }
  const colorCells = (doc.model?.colorCells ?? []).map((c: any) => ({ ...c, paletteSlot: remapSlot(c.paletteSlot) }))
  return { ...doc, schemaVersion: 3, palette, model: { ...doc.model, colorCells } }
}

/** v3 → v4: the `animations` field was added for per-slice animation settings. v3 projects simply
 * get an empty animations array (no animations). */
MIGRATIONS[3] = (doc) => ({ ...doc, schemaVersion: 4 })

export class UnsupportedSchemaVersionError extends Error {
  constructor(foundVersion: unknown) {
    super(`This file is from a newer version of VoxPaint (schemaVersion=${String(foundVersion)}). Please update the app.`)
    this.name = 'UnsupportedSchemaVersionError'
  }
}

export function migrateToCurrent(json: unknown): VoxPaintProjectFile {
  let doc = json as any
  const version: number = doc?.schemaVersion ?? 0

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(doc?.schemaVersion)
  }

  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) break
    doc = step(doc)
  }

  return doc as VoxPaintProjectFile
}
