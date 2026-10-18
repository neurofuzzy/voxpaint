import type { StateCreator } from 'zustand'
import { AO_DEFAULT_ENABLED } from '@/engine/ao/aoConstants'
import type { AppState, ViewSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], ViewSlice>

/** Footer copy for selection-clip rejects — Esc clears the selection (see useKeyboardShortcuts). */
export const SELECTION_BLOCKED_MESSAGE = 'Outside the selection — press Esc to clear it'

/** How long the alert lingers after the last offense before auto-clearing. */
const ALERT_TTL_MS = 2600

// Transient, not part of observable state — the pending auto-clear timer plus a monotonic key
// so repeat offenses retrigger the blink animation (BottomBar keys the message span on it).
let alertTimer: ReturnType<typeof setTimeout> | null = null
let alertKey = 0

export const createViewSlice: Slice = (set) => ({
  fullscreen: false,
  edit3D: false,
  hoverCell: null,
  chamferHoverValid: null,
  hoveredFace: null,
  wireframe: false,
  textureFaceMap: false,
  optimizedMesh: false,
  ambientOcclusion: AO_DEFAULT_ENABLED,
  noiseLevel: 0,
  specularNoiseLevel: 0,
  noiseScale: 1,
  glassRoughnessLevel: 0.3,
  meshTriangles: null,
  aoStrength: 1,
  exposure: 1,
  statusMessage: null,
  statusAlert: null,
  onionSkin: true,
  exportScaleFactor: 100,
  exportAnchor: 'center',
  exportAlignToObjectBounds: false,
  exportDisableMeshOptimization: false,
  exportIncludeTextureMaps: true,
  exportIncludeAOMaps: true,
  exportIncludeMarkers: true,

  setFullscreen: (v) => set((state) => { state.fullscreen = v }),
  setEdit3D: (v) => set((state) => { state.edit3D = v }),
  setWireframe: (v) => set((state) => { state.wireframe = v }),
  setTextureFaceMap: (v) => set((state) => { state.textureFaceMap = v }),
  setOptimizedMesh: (v) => set((state) => { state.optimizedMesh = v }),
  setAmbientOcclusion: (v) => set((state) => { state.ambientOcclusion = v; state.dirty = true }),
  setNoiseLevel: (v) => set((state) => { state.noiseLevel = v; state.dirty = true }),
  setSpecularNoiseLevel: (v) => set((state) => { state.specularNoiseLevel = v; state.dirty = true }),
  setNoiseScale: (v) => set((state) => { state.noiseScale = v; state.dirty = true }),
  setGlassRoughnessLevel: (v) => set((state) => { state.glassRoughnessLevel = v; state.dirty = true }),
  setMeshTriangles: (v) => set((state) => { state.meshTriangles = v }),
  setAoStrength: (v) => set((state) => { state.aoStrength = v; state.dirty = true }),
  setExposure: (v) => set((state) => { state.exposure = v; state.dirty = true }),
  setHoverCell: (coord, chamferValid) =>
    set((state) => {
      state.hoverCell = coord
      state.chamferHoverValid = chamferValid
    }),
  setHoveredFace: (face) => set((state) => { state.hoveredFace = face }),
  setStatusMessage: (msg) => set((state) => { state.statusMessage = msg }),
  flashSelectionBlocked: () => {
    if (alertTimer) clearTimeout(alertTimer)
    alertKey += 1
    const key = alertKey
    set((state) => { state.statusAlert = { message: SELECTION_BLOCKED_MESSAGE, key } })
    alertTimer = setTimeout(() => {
      alertTimer = null
      // Only clear our own generation — a newer flash re-arms the timer for itself.
      set((state) => { if (state.statusAlert?.key === key) state.statusAlert = null })
    }, ALERT_TTL_MS)
  },
  clearStatusAlert: () => {
    if (alertTimer) {
      clearTimeout(alertTimer)
      alertTimer = null
    }
    set((state) => { state.statusAlert = null })
  },
  setOnionSkin: (v) => set((state) => { state.onionSkin = v }),
  setExportScaleFactor: (v) => set((state) => { state.exportScaleFactor = v; state.dirty = true }),
  setExportAnchor: (v) => set((state) => { state.exportAnchor = v; state.dirty = true }),
  setExportAlignToObjectBounds: (v) => set((state) => { state.exportAlignToObjectBounds = v; state.dirty = true }),
  setExportDisableMeshOptimization: (v) => set((state) => { state.exportDisableMeshOptimization = v; state.dirty = true }),
  setExportIncludeTextureMaps: (v) => set((state) => { state.exportIncludeTextureMaps = v; state.dirty = true }),
  setExportIncludeAOMaps: (v) => set((state) => { state.exportIncludeAOMaps = v; state.dirty = true }),
  setExportIncludeMarkers: (v) => set((state) => { state.exportIncludeMarkers = v; state.dirty = true }),
})
