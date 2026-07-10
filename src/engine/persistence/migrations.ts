import { CURRENT_SCHEMA_VERSION, type VoxPaintProjectFile } from './schema'

type Migration = (json: any) => any

/**
 * Ordered, one-step-per-version migration chain. Empty for v1 — there is nothing to migrate
 * from yet — but the pattern exists from day one so future schema bumps are additive, not a
 * retrofit against real user data.
 */
const MIGRATIONS: Migration[] = []

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
