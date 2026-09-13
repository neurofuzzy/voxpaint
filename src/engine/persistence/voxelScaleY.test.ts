import { describe, expect, it } from 'vitest'
import { emptyModel } from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
import { migrateToCurrent } from './migrations'
import { deserializeProject, serializeProject } from './serialize'
import type { ProjectMeta, VoxPaintProjectFileV1 } from './schema'
import type { VoxelScaleY } from '@/engine/grid/types'

const baseMeta: ProjectMeta = { name: 'T', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', gridExtent: 16, noiseSeed: 0, voxelScaleY: 1 }
/** `ProjectMeta` as read from a possibly pre-scale file (field may be absent). */
type MetaWithScale = Omit<ProjectMeta, 'voxelScaleY'> & { voxelScaleY?: VoxelScaleY }

describe('voxelScaleY persistence', () => {
  it('round-trips a non-default scale through serialize → deserialize', () => {
    const meta = { ...baseMeta, voxelScaleY: 0.5 } as ProjectMeta
    const file = serializeProject(emptyModel(), DEFAULT_PALETTE, meta, emptyTextureModel(16))
    expect((file.meta as MetaWithScale).voxelScaleY).toBe(0.5)
    const restored = deserializeProject(file).meta as MetaWithScale
    expect(restored.voxelScaleY).toBe(0.5)
  })

  it('pre-scale project files default to 1x', () => {
    const file = serializeProject(emptyModel(), DEFAULT_PALETTE, baseMeta, emptyTextureModel(16))
    // Simulate a file written before the scale existed.
    delete (file.meta as MetaWithScale).voxelScaleY
    const restored = deserializeProject(file).meta as MetaWithScale
    expect(restored.voxelScaleY).toBe(1)
  })

  it('migrated v1 files load at 1x', () => {
    const legacyMeta = { ...baseMeta }
    delete (legacyMeta as MetaWithScale).voxelScaleY
    const v1: VoxPaintProjectFileV1 = {
      schemaVersion: 1,
      meta: legacyMeta,
      palette: DEFAULT_PALETTE,
      model: { bounds: null, colorCells: [], chamferCells: [] },
    }
    const restored = deserializeProject(migrateToCurrent(v1)).meta as MetaWithScale
    expect(restored.voxelScaleY).toBe(1)
  })
})
