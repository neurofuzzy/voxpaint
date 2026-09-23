import type { StateCreator } from 'zustand'
import { withinWorkingBounds } from '@/engine/grid/GridStore'
import { createMarker } from '@/engine/markers/markers'
import { MARKER_COLORS } from '@/engine/markers/types'
import type { AppState, MarkerSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], MarkerSlice>

function validColor(color: number): boolean {
  return Number.isInteger(color) && color >= 0 && color < MARKER_COLORS.length
}

export const createMarkerSlice: Slice = (set, get) => ({
  markers: [],
  selectedMarkerId: null,
  activeMarkerColor: 1,

  addMarker: (coord) =>
    set((state) => {
      if (!withinWorkingBounds(coord, state.meta.gridExtent)) return
      const marker = createMarker(coord, state.activeMarkerColor)
      state.markers.push(marker)
      state.selectedMarkerId = marker.id
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    }),

  moveMarker: (id, coord) =>
    set((state) => {
      if (!withinWorkingBounds(coord, state.meta.gridExtent)) return
      const marker = state.markers.find((m) => m.id === id)
      if (!marker) return
      marker.position = [coord[0], coord[1], coord[2]]
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    }),

  setMarkerColor: (id, color) => {
    if (!validColor(color)) return
    // A pending float holds an open undo stroke — bake it first so this marker stroke brackets
    // only the recolor (same discipline as every other model mutation).
    get().bakeFloatIfAny()
    get().beginStroke()
    set((state) => {
      const marker = state.markers.find((m) => m.id === id)
      if (!marker || marker.color === color) return
      marker.color = color
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  deleteMarker: (id) => {
    get().bakeFloatIfAny()
    get().beginStroke()
    set((state) => {
      const idx = state.markers.findIndex((m) => m.id === id)
      if (idx === -1) return
      state.markers.splice(idx, 1)
      if (state.selectedMarkerId === id) state.selectedMarkerId = null
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  selectMarker: (id) =>
    set((state) => {
      state.selectedMarkerId = id
    }),

  setActiveMarkerColor: (color) =>
    set((state) => {
      if (validColor(color)) state.activeMarkerColor = color
    }),
})
