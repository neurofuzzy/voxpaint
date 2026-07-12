import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { emptyTextureModel, getTexel } from '@/engine/texture/TextureStore'
import { migrateToCurrent } from './migrations'
import { deserializeProject, serializeProject } from './serialize'
import type { ProjectMeta, VoxPaintProjectFileV1 } from './schema'

const meta: ProjectMeta = { name: 'T', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' }

describe('serialize v2 with texture', () => {
  it('round-trips a painted texture through serialize → deserialize', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })

    const texture = emptyTextureModel()
    texture.faces.pz[0] = 4
    texture.faces.nx[100] = 1

    const file = serializeProject(model, DEFAULT_PALETTE, meta, texture)
    expect(file.schemaVersion).toBe(2)
    expect(file.texture?.faceSize).toBeGreaterThan(0)

    const restored = deserializeProject(file)
    expect(getTexel(restored.texture, 'pz', 0, 0)).toBe(4)
    expect(restored.texture.faces.nx[100]).toBe(1)
    // Untouched texels remain EMPTY.
    expect(getTexel(restored.texture, 'py', 5, 5)).toBe(255)
  })
})

describe('v1 → v2 migration', () => {
  it('stamps schemaVersion 2 and loads with an empty texture', () => {
    const v1: VoxPaintProjectFileV1 = {
      schemaVersion: 1,
      meta,
      palette: DEFAULT_PALETTE,
      model: { bounds: null, colorCells: [], chamferCells: [] },
    }
    const migrated = migrateToCurrent(v1)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.texture).toBeUndefined()

    const restored = deserializeProject(migrated)
    // A migrated v1 file gets a fresh empty texture (all EMPTY).
    expect(getTexel(restored.texture, 'pz', 0, 0)).toBe(255)
  })
})
