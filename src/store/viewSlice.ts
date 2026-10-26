import type { StateCreator } from 'zustand'
import { AO_DEFAULT_ENABLED } from '@/engine/ao/aoConstants'
import { loadUiPrefs, saveUiPrefs } from '@/engine/persistence/uiPrefs'
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

export const createViewSlice: Slice = (set, get) => ({
  fullscreen: false,
  // Restored from localStorage UI prefs (validated there); defaults to the 2D/3D split.
  // The app always boots into Model mode, so the boot layout is Model's remembered one
  // (falling back to the live pref for pre-existing installs without it).
  layoutMode: loadUiPrefs().modelLayout ?? loadUiPrefs().layoutMode ?? 'split',
  // Model's own layout, remembered across tab switches and refreshes (see modelLayout pref).
  modelLayout: loadUiPrefs().modelLayout ?? loadUiPrefs().layoutMode ?? 'split',
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
  touchPaintHold: false,
  statusMessage: null,
  statusAlert: null,
  onionSkin: true,
  exportScaleFactor: 100,
  exportAnchor: 'center',
  exportAlignToObjectBounds: false,
  exportDisableMeshOptimization: false,
  exportCullInteriorFaces: true,
  exportIncludeTextureMaps: true,
  exportIncludeAOMaps: true,
  exportIncludeMarkers: true,

  setFullscreen: (v) => set((state) => { state.fullscreen = v }),
  setLayoutMode: (v) => {
    // Animate and Texture modes edit on the 2D canvas — 3D-only has no editing surface there,
    // so the layout is pinned to split outside Model mode (the collapse button hides there too;
    // this guard keeps the invariant airtight for any other caller).
    const effective = v === '3d-only' && get().mode !== 'model' ? 'split' : v
    // Read-modify-write so unrelated prefs (e.g. dontShowSplash) survive the update. Model-mode
    // changes also record Model's remembered layout (forced splits elsewhere leave it alone).
    const inModel = get().mode === 'model'
    saveUiPrefs({ ...loadUiPrefs(), layoutMode: effective, ...(inModel ? { modelLayout: effective } : {}) })
    set((state) => {
      state.layoutMode = effective
      if (inModel) state.modelLayout = effective
      // A layout switch ends any open 3D line gesture — the anchor belongs to the old context.
      state.paintLineAnchor = null
    })
  },
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
  setTouchPaintHold: (v) => set((state) => { state.touchPaintHold = v }),
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
  setExportCullInteriorFaces: (v) => set((state) => { state.exportCullInteriorFaces = v; state.dirty = true }),
  setExportIncludeTextureMaps: (v) => set((state) => { state.exportIncludeTextureMaps = v; state.dirty = true }),
  setExportIncludeAOMaps: (v) => set((state) => { state.exportIncludeAOMaps = v; state.dirty = true }),
  setExportIncludeMarkers: (v) => set((state) => { state.exportIncludeMarkers = v; state.dirty = true }),
})
