import { CURRENT_SCHEMA_VERSION, type VoxPaintProjectFile } from './schema'

type Migration = (json: any) => any

/**
 * Ordered, one-step-per-version migration chain: `MIGRATIONS[v]` upgrades a `schemaVersion === v`
 * doc to `v + 1`. v1 → v2 just stamps the new version — the `texture` field is optional, so a v1
 * project simply loads with no texture (an empty one is supplied at deserialize time).
 */
const MIGRATIONS: Migration[] = []
MIGRATIONS[1] = (doc) => ({ ...doc, schemaVersion: 2 })

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
