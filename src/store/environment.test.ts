import { beforeEach, describe, expect, it } from 'vitest'
import { emptyModel } from '@/engine/grid/GridStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
import { deserializeProject, serializeProject } from '@/engine/persistence/serialize'
import type { ProjectMeta } from '@/engine/persistence/schema'
import { useAppStore } from './useAppStore'

const meta: ProjectMeta = { name: 'T', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', gridExtent: 16, noiseSeed: 0, voxelScaleY: 1 }

describe('preview environment', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('defaults to neutral with no custom file', () => {
    const s = useAppStore.getState()
    expect(s.environment).toBe('neutral')
    expect(s.customEnvUrl).toBeNull()
    expect(s.customEnvName).toBeNull()
  })

  it('setEnvironment persists the choice and dirties the project', () => {
    useAppStore.getState().setEnvironment('studio')
    const s = useAppStore.getState()
    expect(s.environment).toBe('studio')
    expect(s.dirty).toBe(true)
  })

  it('setCustomEnvUrl is session-only and does not dirty the project', () => {
    useAppStore.setState((state) => { state.dirty = false })
    useAppStore.getState().setCustomEnvUrl('blob:fake', 'studio.hdr')
    const s = useAppStore.getState()
    expect(s.customEnvUrl).toBe('blob:fake')
    expect(s.customEnvName).toBe('studio.hdr')
    expect(s.dirty).toBe(false)
  })

  it('round-trips the environment choice through serialize → deserialize', () => {
    useAppStore.getState().setEnvironment('studio')
    const s = useAppStore.getState()
    const file = serializeProject(s.model, s.palette, s.meta, s.texture, {
      ambientOcclusion: false, noiseLevel: 0, specularNoiseLevel: 0, aoStrength: 1,
      glassRoughnessLevel: 0.3, exposure: 1, environment: s.environment,
      exportScaleFactor: 100, exportAnchor: 'center', exportAlignToObjectBounds: false,
      exportDisableMeshOptimization: false, exportIncludeTextureMaps: true,
    })
    expect(deserializeProject(file).view.environment).toBe('studio')
  })

  it('round-trips the outdoor choice too', () => {
    useAppStore.getState().setEnvironment('outdoor')
    const s = useAppStore.getState()
    const file = serializeProject(s.model, s.palette, s.meta, s.texture, {
      ambientOcclusion: false, noiseLevel: 0, specularNoiseLevel: 0, aoStrength: 1,
      glassRoughnessLevel: 0.3, exposure: 1, environment: s.environment,
      exportScaleFactor: 100, exportAnchor: 'center', exportAlignToObjectBounds: false,
      exportDisableMeshOptimization: false, exportIncludeTextureMaps: true,
    })
    expect(deserializeProject(file).view.environment).toBe('outdoor')
  })

  it('files without an environment default to neutral', () => {    const file = serializeProject(emptyModel(), DEFAULT_PALETTE, meta, emptyTextureModel(16), {
      ambientOcclusion: false, noiseLevel: 0, specularNoiseLevel: 0, aoStrength: 1,
      glassRoughnessLevel: 0.3, exposure: 1,
      exportScaleFactor: 100, exportAnchor: 'center', exportAlignToObjectBounds: false,
      exportDisableMeshOptimization: false, exportIncludeTextureMaps: true,
    })
    expect(deserializeProject(file).view.environment).toBe('neutral')
  })
})
