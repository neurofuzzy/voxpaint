import type { StateCreator } from 'zustand'
import { AO_DEFAULT_ENABLED } from '@/engine/ao/aoConstants'
import type { AppState, ViewSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ViewSlice>

export const createViewSlice: Slice = (set) => ({
  fullscreen: false,
  edit3D: false,
  hoverCell: null,
  chamferHoverValid: null,
  hoveredFace: null,
  wireframe: false,
  optimizedMesh: false,
  ambientOcclusion: AO_DEFAULT_ENABLED,
  noiseLevel: 0,
  specularNoiseLevel: 0,
  glassRoughnessLevel: 0.3,
  meshTriangles: null,
  aoStrength: 1,
  exposure: 1,
  environment: 'neutral',
  customEnvUrl: null,
  customEnvName: null,
  statusMessage: null,
  onionSkin: true,
  exportScaleFactor: 100,
  exportAnchor: 'center',
  exportAlignToObjectBounds: false,
  exportDisableMeshOptimization: false,
  exportIncludeTextureMaps: true,

  setFullscreen: (v) => set((state) => { state.fullscreen = v }),
  setEdit3D: (v) => set((state) => { state.edit3D = v }),
  setWireframe: (v) => set((state) => { state.wireframe = v }),
  setOptimizedMesh: (v) => set((state) => { state.optimizedMesh = v }),
  setAmbientOcclusion: (v) => set((state) => { state.ambientOcclusion = v; state.dirty = true }),
  setNoiseLevel: (v) => set((state) => { state.noiseLevel = v; state.dirty = true }),
  setSpecularNoiseLevel: (v) => set((state) => { state.specularNoiseLevel = v; state.dirty = true }),
  setGlassRoughnessLevel: (v) => set((state) => { state.glassRoughnessLevel = v; state.dirty = true }),
  setMeshTriangles: (v) => set((state) => { state.meshTriangles = v }),
  setAoStrength: (v) => set((state) => { state.aoStrength = v; state.dirty = true }),
  setExposure: (v) => set((state) => { state.exposure = v; state.dirty = true }),
  setEnvironment: (v) => set((state) => { state.environment = v; state.dirty = true }),
  // Session-only (a blob URL can't be persisted) — deliberately doesn't dirty the project.
  setCustomEnvUrl: (url, name) => set((state) => { state.customEnvUrl = url; state.customEnvName = name }),
  setHoverCell: (coord, chamferValid) =>
    set((state) => {
      state.hoverCell = coord
      state.chamferHoverValid = chamferValid
    }),
  setHoveredFace: (face) => set((state) => { state.hoveredFace = face }),
  setStatusMessage: (msg) => set((state) => { state.statusMessage = msg }),
  setOnionSkin: (v) => set((state) => { state.onionSkin = v }),
  setExportScaleFactor: (v) => set((state) => { state.exportScaleFactor = v; state.dirty = true }),
  setExportAnchor: (v) => set((state) => { state.exportAnchor = v; state.dirty = true }),
  setExportAlignToObjectBounds: (v) => set((state) => { state.exportAlignToObjectBounds = v; state.dirty = true }),
  setExportDisableMeshOptimization: (v) => set((state) => { state.exportDisableMeshOptimization = v; state.dirty = true }),
  setExportIncludeTextureMaps: (v) => set((state) => { state.exportIncludeTextureMaps = v; state.dirty = true }),
})
