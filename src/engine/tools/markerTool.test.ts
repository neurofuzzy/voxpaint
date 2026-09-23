import { describe, expect, it, vi } from 'vitest'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import type { Marker } from '@/engine/markers/types'
import { markerTool } from './markerTool'
import type { ToolContext } from './types'

function makeCtx(): ToolContext & {
  live: Marker[]
  strokes: number
  commits: number
} {
  const live: Marker[] = []
  let counter = 0
  const plane = { axis: 'y', orientation: 1, offset: 0 } as const
  const base = {
    live,
    strokes: 0,
    commits: 0,
    activeMarkerColor: 3,
    markerAtCoord(u: number, v: number) {
      const [x, y, z] = gridCoordFromPixel(plane, u, v)
      return live.find((m) => m.position[0] === x && m.position[1] === y && m.position[2] === z) ?? null
    },
    addMarkerAtCoord(u: number, v: number) {
      const [x, y, z] = gridCoordFromPixel(plane, u, v)
      if (Math.abs(x) > 8 || Math.abs(y) > 8 || Math.abs(z) > 8) return null
      counter += 1
      const m: Marker = { id: `m${counter}`, color: 1, position: [x, y, z] }
      live.push(m)
      return m
    },
    moveMarkerToCoord(id: string, u: number, v: number) {
      const m = live.find((m) => m.id === id)
      if (!m) return
      const [x, y, z] = gridCoordFromPixel(plane, u, v)
      m.position = [x, y, z]
    },
    recolorMarker(id: string, color: number) {
      const m = live.find((m) => m.id === id)
      if (!m) return
      m.color = color
    },
    removeMarker(id: string) {
      const idx = live.findIndex((m) => m.id === id)
      if (idx !== -1) live.splice(idx, 1)
    },
    selectMarker: vi.fn(),
    bakeFloatIfAny: vi.fn(),
    beginStroke() { this.strokes += 1 },
    commitStroke() { this.commits += 1 },
  }
  return {
    ...base,
    model: { color: new Map(), chamfer: new Map(), bounds: null },
    plane: { axis: 'y', orientation: 1, offset: 0 },
    gridExtent: 16,
    activeVoxelKind: 'cube',
    activePaletteSlot: { kind: 'base', index: 0 },
    selection: null,
    floatContent: null,
    floatOrigin: null,
    clipboard: null,
    markers: [],
    selectedMarkerId: null,
    paintCell: () => false,
    eraseCell: () => {},
    paintMaterialCell: () => false,
    rebaseRampCell: () => false,
    floodFill: () => {},
    floodFill3D: () => {},
    paintMaskCell: () => false,
    eraseMaskCell: () => {},
    setPivotForCurrentSlice: () => false,
    clearPivotForCurrentSlice: () => {},
    animBeginStroke: () => {},
    animCommitStroke: () => {},
    beginMove: () => {},
    updateMove: () => {},
    endMove: () => {},
    cloneStampCell: () => {},
    setActivePaletteSlot: () => {},
    setActiveTool: () => {},
    setSelection: () => {},
    liftSelectionToFloat: () => {},
    moveFloatTo: () => {},
    transformFloat: () => {},
    linePreview: null,
    setLinePreview: () => {},
    selectPreview: null,
    setSelectPreview: () => {},
    drag: { current: { kind: 'idle' } },
    cloneSourceRef: { current: null },
    cloneOffsetRef: { current: null },
  } as unknown as ToolContext & { live: Marker[]; strokes: number; commits: number }
}

const evt = (u: number, v: number) => ({ u, v, button: 0, buttons: 1, shiftKey: false, altKey: false, metaKey: false, pointerId: 1 })

describe('markerTool', () => {
  it('places a marker on empty cell as one stroke', () => {
    const ctx = makeCtx()
    markerTool.onDown!(ctx, evt(1, 2))
    expect(ctx.live.length).toBe(1)
    expect(ctx.drag.current.kind).toBe('marker')
    markerTool.onUp!(ctx, evt(1, 2))
    expect(ctx.strokes).toBe(1)
    expect(ctx.commits).toBe(1)
    expect(ctx.drag.current.kind).toBe('idle')
  })

  it('selects and drags an existing marker', () => {
    const ctx = makeCtx()
    markerTool.onDown!(ctx, evt(0, 0))
    markerTool.onUp!(ctx, evt(0, 0))
    const id = ctx.live[0].id
    markerTool.onDown!(ctx, evt(0, 0))
    expect(ctx.drag.current).toEqual({ kind: 'marker-pending', id, startU: 0, startV: 0 })
    markerTool.onMove!(ctx, evt(3, 1))
    markerTool.onUp!(ctx, evt(3, 1))
    expect(ctx.live[0].position).toEqual(gridCoordFromPixel(ctx.plane, 3, 1))
    expect(ctx.strokes).toBe(2)
    expect(ctx.commits).toBe(2)
  })

  it('tapping a different-colored marker recolors it to the active color', () => {
    const ctx = makeCtx() // active color 3, placed markers default to color 1
    markerTool.onDown!(ctx, evt(0, 0))
    markerTool.onUp!(ctx, evt(0, 0))
    expect(ctx.live[0].color).toBe(1)
    markerTool.onDown!(ctx, evt(0, 0))
    markerTool.onUp!(ctx, evt(0, 0))
    expect(ctx.live).toHaveLength(1)
    expect(ctx.live[0].color).toBe(3)
    expect(ctx.strokes).toBe(2)
    expect(ctx.commits).toBe(2)
  })

  it('tapping a same-colored marker deletes it', () => {
    const ctx = makeCtx()
    ctx.activeMarkerColor = 1 // match the placed default so the tap deletes
    markerTool.onDown!(ctx, evt(0, 0))
    markerTool.onUp!(ctx, evt(0, 0))
    expect(ctx.live).toHaveLength(1)
    markerTool.onDown!(ctx, evt(0, 0))
    markerTool.onUp!(ctx, evt(0, 0))
    expect(ctx.live).toHaveLength(0)
    expect(ctx.strokes).toBe(2)
    expect(ctx.commits).toBe(2)
  })

  it('ignores right-click', () => {
    const ctx = makeCtx()
    markerTool.onDown!(ctx, { ...evt(0, 0), button: 2 })
    expect(ctx.live.length).toBe(0)
    expect(ctx.strokes).toBe(0)
  })
})
