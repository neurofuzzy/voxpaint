import type { StateCreator } from 'zustand'
import { AO_DEFAULT_ENABLED } from '@/engine/ao/aoConstants'
import type { AppState, ViewSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ViewSlice>

export const createViewSlice: Slice = (set) => ({
  fullscreen: false,
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
  statusMessage: null,
  onionSkin: true,

  setFullscreen: (v) => set((state) => { state.fullscreen = v }),
  setWireframe: (v) => set((state) => { state.wireframe = v }),
  setOptimizedMesh: (v) => set((state) => { state.optimizedMesh = v }),
  setAmbientOcclusion: (v) => set((state) => { state.ambientOcclusion = v; state.dirty = true }),
  setNoiseLevel: (v) => set((state) => { state.noiseLevel = v; state.dirty = true }),
  setSpecularNoiseLevel: (v) => set((state) => { state.specularNoiseLevel = v; state.dirty = true }),
  setGlassRoughnessLevel: (v) => set((state) => { state.glassRoughnessLevel = v; state.dirty = true }),
  setMeshTriangles: (v) => set((state) => { state.meshTriangles = v }),
  setAoStrength: (v) => set((state) => { state.aoStrength = v; state.dirty = true }),
  setHoverCell: (coord, chamferValid) =>
    set((state) => {
      state.hoverCell = coord
      state.chamferHoverValid = chamferValid
    }),
  setHoveredFace: (face) => set((state) => { state.hoveredFace = face }),
  setStatusMessage: (msg) => set((state) => { state.statusMessage = msg }),
  setOnionSkin: (v) => set((state) => { state.onionSkin = v }),
})
