import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { emptyTextureModel, getTexel } from '@/engine/texture/TextureStore'
import { faceSizeFor } from '@/engine/texture/types'
import { migrateToCurrent } from './migrations'
import { deserializeProject, serializeProject } from './serialize'
import type { ProjectMeta, VoxPaintProjectFileV1 } from './schema'

const meta: ProjectMeta = { name: 'T', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', gridExtent: 16, noiseSeed: 0, voxelScaleY: 1 }
const faceSize = faceSizeFor(meta.gridExtent)

describe('serialize with texture', () => {
  it('round-trips a painted texture through serialize → deserialize', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })

    const texture = emptyTextureModel(meta.gridExtent)
    texture.faces.pz[0] = 4
    texture.faces.nx[100] = 1

    const file = serializeProject(model, DEFAULT_PALETTE, meta, texture)
    expect(file.schemaVersion).toBe(9)
    expect(file.texture?.faceSize).toBeGreaterThan(0)

    const restored = deserializeProject(file)
    expect(getTexel(restored.texture, 'pz', 0, 0, faceSize)).toBe(4)
    expect(restored.texture.faces.nx[100]).toBe(1)
    // Untouched texels remain EMPTY.
    expect(getTexel(restored.texture, 'py', 5, 5, faceSize)).toBe(255)
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
    expect(migrated.schemaVersion).toBe(9)
    expect(migrated.texture).toBeUndefined()
    expect(migrated.meta.gridExtent).toBe(16)

    const restored = deserializeProject(migrated)
    // A migrated v1 file gets a fresh empty texture (all EMPTY).
    expect(getTexel(restored.texture, 'pz', 0, 0, faceSize)).toBe(255)
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
    expect(migrated.schemaVersion).toBe(9)
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

describe('markers persistence (v9)', () => {
  it('round-trips markers through serialize → deserialize', () => {
    const model = emptyModel()
    const texture = emptyTextureModel(meta.gridExtent)
    const markers = [
      { id: 'a', color: 2, position: [1, 2, 3] as [number, number, number], planeAxis: 'x' as const, planeOrientation: -1 as const },
      { id: 'b', color: 0, position: [-4, 0, 7] as [number, number, number], planeAxis: 'y' as const, planeOrientation: 1 as const },
    ]
    const file = serializeProject(model, DEFAULT_PALETTE, meta, texture, undefined, undefined, undefined, undefined, markers)
    expect(file.markers).toHaveLength(2)
    const restored = deserializeProject(file)
    expect(restored.markers).toEqual(markers)
  })

  it('drops out-of-bounds and duplicate markers on load, clamps bad colors and facings', () => {
    const model = emptyModel()
    const texture = emptyTextureModel(meta.gridExtent)
    const file = serializeProject(model, DEFAULT_PALETTE, meta, texture, undefined, undefined, undefined, undefined, [
      { id: 'a', color: 2, position: [0, 0, 0], planeAxis: 'z' as const, planeOrientation: 1 as const },
    ])
    file.markers!.push(
      { id: 'far', color: 0, x: 99, y: 0, z: 0, planeAxis: 'y', planeOrientation: 1 },
      { id: 'a', color: 0, x: 1, y: 1, z: 1, planeAxis: 'y', planeOrientation: 1 },
      // Hand-corrupt facing: falls back to up rather than dropping the marker.
      { id: 'bad', color: 99, x: 1, y: 1, z: 1, planeAxis: 'w', planeOrientation: 0 } as any,
    )
    const restored = deserializeProject(file)
    expect(restored.markers.map((m) => m.id)).toEqual(['a', 'bad'])
    expect(restored.markers.find((m) => m.id === 'bad')?.color).toBe(1)
    expect(restored.markers.find((m) => m.id === 'bad')).toMatchObject({ planeAxis: 'y', planeOrientation: 1 })
  })

  it('loads pre-marker files with no markers', () => {
    const v6 = {
      schemaVersion: 6,
      meta,
      palette: DEFAULT_PALETTE,
      model: { bounds: null, colorCells: [], chamferCells: [] },
    }
    const migrated = migrateToCurrent(v6)
    expect(migrated.schemaVersion).toBe(9)
    expect(deserializeProject(migrated).markers).toEqual([])
  })

  it('migrates v7 labeled markers to the default color, keeping ids and positions', () => {
    const v7 = {
      schemaVersion: 7,
      meta,
      palette: DEFAULT_PALETTE,
      model: { bounds: null, colorCells: [], chamferCells: [] },
      markers: [
        { id: 'a', label: 'Tree', x: 1, y: 2, z: 3 },
        { id: 'nope', label: 'oob', x: 99, y: 0, z: 0 },
      ],
    }
    const migrated = migrateToCurrent(v7)
    expect(migrated.schemaVersion).toBe(9)
    expect(migrated.markers).toEqual([
      { id: 'a', color: 1, x: 1, y: 2, z: 3, planeAxis: 'y', planeOrientation: 1 },
      { id: 'nope', color: 1, x: 99, y: 0, z: 0, planeAxis: 'y', planeOrientation: 1 },
    ])
    // Out-of-bounds markers are dropped at deserialize time, as usual.
    expect(deserializeProject(migrated).markers).toEqual([
      { id: 'a', color: 1, position: [1, 2, 3], planeAxis: 'y', planeOrientation: 1 },
    ])
  })

  it('migrates v8 color markers to face up, keeping everything else', () => {
    const v8 = {
      schemaVersion: 8,
      meta,
      palette: DEFAULT_PALETTE,
      model: { bounds: null, colorCells: [], chamferCells: [] },
      markers: [{ id: 'a', color: 3, x: 1, y: 2, z: 3 }],
    }
    const migrated = migrateToCurrent(v8)
    expect(migrated.schemaVersion).toBe(9)
    expect(deserializeProject(migrated).markers).toEqual([
      { id: 'a', color: 3, position: [1, 2, 3], planeAxis: 'y', planeOrientation: 1 },
    ])
  })
})
