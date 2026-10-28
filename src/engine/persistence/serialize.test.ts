import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey } from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { emptyTextureModel, getTexel } from '@/engine/texture/TextureStore'
import { faceSizeFor } from '@/engine/texture/types'
import { migrateToCurrent } from './migrations'
import { deserializeProject, serializeProject } from './serialize'
import type { RigBox } from '@/engine/rigging/types'
import type { ProjectMeta, VoxPaintProjectFileV1 } from './schema'
import { CURRENT_SCHEMA_VERSION } from './schema'

const meta: ProjectMeta = { name: 'T', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', gridExtent: 16, noiseSeed: 0, voxelScaleY: 1 }
const faceSize = faceSizeFor(meta.gridExtent)

describe('serialize with texture', () => {
  it('round-trips a painted texture through serialize → deserialize', () => {    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })

    const texture = emptyTextureModel(meta.gridExtent)
    texture.faces.pz[0] = 4
    texture.faces.nx[100] = 1

    const file = serializeProject(model, DEFAULT_PALETTE, meta, texture)
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(file.texture?.faceSize).toBeGreaterThan(0)

    const restored = deserializeProject(file)
    expect(getTexel(restored.texture, 'pz', 0, 0, faceSize)).toBe(4)
    expect(restored.texture.faces.nx[100]).toBe(1)
    // Untouched texels remain EMPTY.
    expect(getTexel(restored.texture, 'py', 5, 5, faceSize)).toBe(255)
  })
})

describe('serialize with a scaled texture', () => {
  it('round-trips texelScale 1 faces and records the scale', () => {
    const scaledMeta: ProjectMeta = { ...meta, texelScale: 1 }
    const scaledSize = faceSizeFor(scaledMeta.gridExtent, 1)
    const texture = emptyTextureModel(scaledMeta.gridExtent, 1)
    texture.faces.px[0] = 6

    const file = serializeProject(emptyModel(), DEFAULT_PALETTE, scaledMeta, texture)
    expect(file.texture?.texelScale).toBe(1)
    expect(file.texture?.faceSize).toBe(scaledSize)

    const restored = deserializeProject(file)
    expect(restored.meta.texelScale).toBe(1)
    expect(restored.texture.faces.px.length).toBe(scaledSize * scaledSize)
    expect(getTexel(restored.texture, 'px', 0, 0, scaledSize)).toBe(6)
  })

  it('loads pre-scale files at full detail', () => {
    const texture = emptyTextureModel(meta.gridExtent)
    texture.faces.px[0] = 2
    const file = serializeProject(emptyModel(), DEFAULT_PALETTE, meta, texture)
    // The shared test meta carries no texelScale (like an old file) — serializes as 4.
    expect(file.texture?.texelScale).toBe(4)
    const restored = deserializeProject(file)
    expect(restored.meta.texelScale).toBe(4)
    expect(getTexel(restored.texture, 'px', 0, 0, faceSize)).toBe(2)
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
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
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
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
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
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
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
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
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
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(deserializeProject(migrated).markers).toEqual([
      { id: 'a', color: 3, position: [1, 2, 3], planeAxis: 'y', planeOrientation: 1 },
    ])
  })
})

describe('half slabs persistence (v10)', () => {
  it('round-trips half cells through serialize → deserialize', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })
    model.chamfer.set(encodeKey(0, 0, 0), {
      planeAxis: 'z',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'half', rotation: 0 },
    })
    const texture = emptyTextureModel(meta.gridExtent)
    const file = serializeProject(model, DEFAULT_PALETTE, meta, texture)
    const restored = deserializeProject(file)
    expect(restored.model.chamfer.get(encodeKey(0, 0, 0))).toEqual({
      planeAxis: 'z',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'half', rotation: 0 },
    })
  })

  it('migrates v9 files untouched, stamping v10', () => {
    const v9 = {
      schemaVersion: 9,
      meta,
      palette: DEFAULT_PALETTE,
      model: { bounds: null, colorCells: [], chamferCells: [] },
    }
    const migrated = migrateToCurrent(v9)
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(deserializeProject(migrated).model.color.size).toBe(0)
  })
})

describe('flats persistence (v11)', () => {
  it('round-trips flat and flatwedge cells through serialize → deserialize', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { kind: 'base', index: 3 } })
    model.chamfer.set(encodeKey(0, 0, 0), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flat', rotation: 0 },
    })
    model.color.set(encodeKey(1, 0, 0), { paletteSlot: { kind: 'base', index: 4 } })
    model.chamfer.set(encodeKey(1, 0, 0), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flatwedge', rotation: 2 },
    })
    const texture = emptyTextureModel(meta.gridExtent)
    const file = serializeProject(model, DEFAULT_PALETTE, meta, texture)
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    const restored = deserializeProject(file)
    expect(restored.model.chamfer.get(encodeKey(0, 0, 0))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flat', rotation: 0 },
    })
    expect(restored.model.chamfer.get(encodeKey(1, 0, 0))).toEqual({
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'flatwedge', rotation: 2 },
    })
  })

  it('migrates v10 files untouched, stamping current', () => {
    const v10 = {
      schemaVersion: 10,
      meta,
      palette: DEFAULT_PALETTE,
      model: { bounds: null, colorCells: [], chamferCells: [] },
    }
    const migrated = migrateToCurrent(v10)
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(deserializeProject(migrated).model.color.size).toBe(0)
  })
})

describe('serialize rig boxes', () => {
  it('round-trips the outline hierarchy through serialize → deserialize', () => {
    const texture = emptyTextureModel(meta.gridExtent)
    const rigBoxes: RigBox[] = [
      { id: 'a', name: 'torso', min: [0, 0, 0] as [number, number, number], max: [3, 3, 3] as [number, number, number], parentId: null, pivot: null, tweens: [] },
      // Half-integer pivots (cell-boundary joint faces) must survive the trip, not just ints.
      { id: 'b', name: 'arm', min: [1, 0, 1] as [number, number, number], max: [2, 3, 2] as [number, number, number], parentId: 'a', pivot: [0.5, 1, 1] as [number, number, number], tweens: [{ id: 'tw-1', kind: 'slide', axis: 'x', direction: -1, speed: 2, amount: 5, enabled: true }] },
    ]
    const file = serializeProject(emptyModel(), DEFAULT_PALETTE, meta, texture, undefined, undefined, undefined, undefined, undefined, rigBoxes)
    expect(file.rigBoxes).toHaveLength(2)
    expect(file.rigBoxes?.[0]).not.toHaveProperty('pivot')
    expect(file.rigBoxes?.[0]).not.toHaveProperty('tweens')
    expect(file.rigBoxes?.[1].pivot).toEqual([0.5, 1, 1])
    expect(file.rigBoxes?.[1].tweens).toEqual([{ id: 'tw-1', kind: 'slide', axis: 'x', direction: -1, speed: 2, amount: 5, enabled: true }])
    const restored = deserializeProject(file)
    expect(restored.rigBoxes).toEqual(rigBoxes)
  })

  it('loads v12 files with pivots unset and drops malformed pivots', () => {
    const texture = emptyTextureModel(meta.gridExtent)
    const v12 = {
      ...serializeProject(emptyModel(), DEFAULT_PALETTE, meta, texture),
      rigBoxes: [
        { id: 'a', name: 'a', min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number], parentId: null },
        { id: 'b', name: 'b', min: [2, 2, 2] as [number, number, number], max: [3, 3, 3] as [number, number, number], parentId: null, pivot: [0, 'x', 0] as unknown as [number, number, number] },
        { id: 'c', name: 'c', min: [4, 4, 4] as [number, number, number], max: [5, 5, 5] as [number, number, number], parentId: null, pivot: [99, 99, 99] as [number, number, number] },
      ],
    }
    const restored = deserializeProject(v12).rigBoxes
    expect(restored.find((b) => b.id === 'a')?.pivot).toBeNull()
    expect(restored.find((b) => b.id === 'b')?.pivot).toBeNull()
    expect(restored.find((b) => b.id === 'c')?.pivot).toBeNull()
  })

  it('loads v14 files by folding the single loop into a one-entry tween stack', () => {
    const texture = emptyTextureModel(meta.gridExtent)
    const v14 = {
      ...serializeProject(emptyModel(), DEFAULT_PALETTE, meta, texture),
      rigBoxes: [
        { id: 'a', name: 'a', min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number], parentId: null },
        { id: 'b', name: 'b', min: [2, 2, 2] as [number, number, number], max: [3, 3, 3] as [number, number, number], parentId: null, loop: { kind: 'rotate', axis: 'y', direction: 1, speed: 3, amount: 4 } },
      ],
      schemaVersion: 14,
    }
    const restored = deserializeProject(migrateToCurrent(v14)).rigBoxes
    expect(restored.find((b) => b.id === 'a')?.tweens ?? []).toEqual([])
    expect(restored.find((b) => b.id === 'b')?.tweens).toEqual([
      { id: 'tw-b-1', kind: 'rotate', axis: 'y', direction: 1, speed: 3, amount: 4, enabled: true },
    ])
  })

  it('drops malformed tweens on load', () => {
    const texture = emptyTextureModel(meta.gridExtent)
    const file = {
      ...serializeProject(emptyModel(), DEFAULT_PALETTE, meta, texture),
      rigBoxes: [
        { id: 'a', name: 'a', min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number], parentId: null, tweens: [{ kind: 'spin', axis: 'y', direction: 1, speed: 1, amount: 4 }] as never },
      ],
    }
    const restored = deserializeProject(file).rigBoxes
    expect(restored.find((b) => b.id === 'a')?.tweens ?? []).toEqual([])
  })

  it('collapses stale duplicate bounds on load, reparenting their children', () => {
    const texture = emptyTextureModel(meta.gridExtent)
    // 'b' is an exact twin of 'a' (stale: creatable before footprint hit-testing selected
    // first); 'c' nests under the twin. Load keeps the first and folds the rest into it.
    const file = serializeProject(emptyModel(), DEFAULT_PALETTE, meta, texture, undefined, undefined, undefined, undefined, undefined, [
      { id: 'a', name: 'torso', min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number], parentId: null, pivot: null },
      { id: 'b', name: 'torso-copy', min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number], parentId: null, pivot: null },
      { id: 'c', name: 'arm', min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number], parentId: 'b', pivot: null },
    ])
    const restored = deserializeProject(file).rigBoxes
    expect(restored.map((b) => b.id).sort()).toEqual(['a', 'c'])
    expect(restored.find((b) => b.id === 'c')?.parentId).toBe('a')
  })

  it('roots pre-hierarchy files and breaks parent cycles', () => {
    const texture = emptyTextureModel(meta.gridExtent)
    const file = serializeProject(emptyModel(), DEFAULT_PALETTE, meta, texture)
    expect(deserializeProject(file).rigBoxes).toEqual([])

    const cyclic = {
      ...serializeProject(emptyModel(), DEFAULT_PALETTE, meta, texture),
      rigBoxes: [
        { id: 'a', name: 'a', min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number], parentId: 'b' },
        { id: 'b', name: 'b', min: [2, 2, 2] as [number, number, number], max: [3, 3, 3] as [number, number, number], parentId: 'a' },
        { id: 'c', name: 'c', min: [4, 4, 4] as [number, number, number], max: [5, 5, 5] as [number, number, number], parentId: 'missing' },
      ],
    }
    const restored = deserializeProject(cyclic).rigBoxes
    expect(restored.find((b) => b.id === 'c')?.parentId).toBeNull()
    // The cycle breaks: at least one of the two links roots.
    const links = restored.filter((b) => b.id === 'a' || b.id === 'b').map((b) => b.parentId)
    expect(links).toContain(null)
  })
})
