import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { emptyTextureModel, getTexel } from '@/engine/texture/TextureStore'
import { migrateToCurrent } from './migrations'
import { deserializeProject, serializeProject } from './serialize'
import type { ProjectMeta, VoxPaintProjectFileV1 } from './schema'

const meta: ProjectMeta = { name: 'T', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' }

describe('serialize with texture', () => {
  it('round-trips a painted texture through serialize → deserialize', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })

    const texture = emptyTextureModel()
    texture.faces.pz[0] = 4
    texture.faces.nx[100] = 1

    const file = serializeProject(model, DEFAULT_PALETTE, meta, texture)
    expect(file.schemaVersion).toBe(3)
    expect(file.texture?.faceSize).toBeGreaterThan(0)

    const restored = deserializeProject(file)
    expect(getTexel(restored.texture, 'pz', 0, 0)).toBe(4)
    expect(restored.texture.faces.nx[100]).toBe(1)
    // Untouched texels remain EMPTY.
    expect(getTexel(restored.texture, 'py', 5, 5)).toBe(255)
  })
})

describe('v1 → current migration', () => {
  it('migrates to the current schema version and loads with an empty texture', () => {
    const v1: VoxPaintProjectFileV1 = {
      schemaVersion: 1,
      meta,
      palette: DEFAULT_PALETTE,
      model: { bounds: null, colorCells: [], chamferCells: [] },
    }
    const migrated = migrateToCurrent(v1)
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.texture).toBeUndefined()

    const restored = deserializeProject(migrated)
    // A migrated v1 file gets a fresh empty texture (all EMPTY).
    expect(getTexel(restored.texture, 'pz', 0, 0)).toBe(255)
  })
})

describe('v2 → v3 migration (blink/pulse → metal/glass)', () => {
  it('reshapes the palette and remaps blink/pulse cells to emissive', () => {
    const v2 = {
      schemaVersion: 2,
      meta,
      palette: {
        base: DEFAULT_PALETTE.base,
        emissive: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
        blink: ['#111111', '#222222', '#333333', '#444444'],
        pulse: ['#555555', '#666666', '#777777', '#888888'],
      },
      model: {
        bounds: null,
        colorCells: [
          { x: 0, y: 0, z: 0, paletteSlot: { kind: 'base', index: 2 } },
          { x: 1, y: 0, z: 0, paletteSlot: { kind: 'blink', index: 3 } },
          { x: 2, y: 0, z: 0, paletteSlot: { kind: 'pulse', index: 1 } },
        ],
        chamferCells: [],
      },
    }
    const migrated = migrateToCurrent(v2) as any
    expect(migrated.schemaVersion).toBe(3)
    // Palette reshaped: metal/glass present, blink/pulse gone; base/emissive preserved.
    expect(migrated.palette.metal).toHaveLength(4)
    expect(migrated.palette.glass).toHaveLength(4)
    expect(migrated.palette.blink).toBeUndefined()
    expect(migrated.palette.pulse).toBeUndefined()
    expect(migrated.palette.emissive[0]).toBe('#ff0000')
    // base cell untouched; blink/pulse cells remapped to emissive with clamped index.
    expect(migrated.model.colorCells[0].paletteSlot).toEqual({ kind: 'base', index: 2 })
    expect(migrated.model.colorCells[1].paletteSlot).toEqual({ kind: 'emissive', index: 3 })
    expect(migrated.model.colorCells[2].paletteSlot).toEqual({ kind: 'emissive', index: 1 })
  })
})
