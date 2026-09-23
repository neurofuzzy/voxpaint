import type { StateCreator } from 'zustand'
import { withinWorkingBounds } from '@/engine/grid/GridStore'
import { createMarker } from '@/engine/markers/markers'
import type { AppState, MarkerSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], MarkerSlice>

export const createMarkerSlice: Slice = (set, get) => ({
  markers: [],
  selectedMarkerId: null,

  addMarker: (coord) =>
    set((state) => {
      if (!withinWorkingBounds(coord, state.meta.gridExtent)) return
      const marker = createMarker(coord, state.markers.length)
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

  renameMarker: (id, label) => {
    get().beginStroke()
    set((state) => {
      const marker = state.markers.find((m) => m.id === id)
      if (!marker) return
      const clean = label.trim().slice(0, 120)
      if (!clean || clean === marker.label) return
      marker.label = clean
      state.meta.modifiedAt = new Date().toISOString()
      state.dirty = true
    })
    get().commitStroke()
  },

  deleteMarker: (id) => {
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
})
