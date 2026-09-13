import { describe, expect, it } from 'vitest'
import { screenToWorld, worldToScreen, clampPan, type CanvasPan, type CanvasSize } from './cameraTransform'
import { BASE_CELL_PX, defaultZoomForExtent } from './canvasConstants'

const size: CanvasSize = { width: 800, height: 600 }
const pan: CanvasPan = { x: 0, y: 0 }
const ZOOM = 1

// worldToScreen/screenToWorld gain an optional v-scale (cells per world unit on the v axis):
// 1 = current square behavior; 0.5/2 = stretched cells on X/Z construction planes.
type W2S = (u: number, v: number, size: CanvasSize, pan: CanvasPan, zoom: number, vScale?: number) => [number, number]
type S2W = (sx: number, sy: number, size: CanvasSize, pan: CanvasPan, zoom: number, vScale?: number) => [number, number]
type Clamp = (pan: CanvasPan, size: CanvasSize, zoom: number, half: number, vScale?: number) => CanvasPan
const w2s = worldToScreen as W2S
const s2w = screenToWorld as S2W
const clamp = clampPan as Clamp

describe('2D viewport v-scale (Y-scaled voxels on X/Z planes)', () => {
  it('1x maps square cells exactly as today', () => {
    expect(w2s(2, 3, size, pan, ZOOM)).toEqual([400 + 2 * BASE_CELL_PX, 300 + 3 * BASE_CELL_PX])
    expect(w2s(2, 3, size, pan, ZOOM, 1)).toEqual([400 + 2 * BASE_CELL_PX, 300 + 3 * BASE_CELL_PX])
  })

  it('stretches only the v axis (u untouched)', () => {
    const [x, y] = w2s(2, 3, size, pan, ZOOM, 0.5)
    expect(x).toBe(400 + 2 * BASE_CELL_PX)
    expect(y).toBe(300 + 3 * BASE_CELL_PX * 0.5)
  })

  it('2x doubles v extent', () => {
    const [, y] = w2s(0, 4, size, pan, ZOOM, 2)
    expect(y).toBe(300 + 4 * BASE_CELL_PX * 2)
  })

  it.each([1, 0.5, 2] as const)('round-trips screen ⇄ world at v-scale %s', (k) => {
    const [sx, sy] = w2s(2.25, -1.5, size, pan, ZOOM, k)
    const [u, v] = s2w(sx, sy, size, pan, ZOOM, k)
    expect(u).toBeCloseTo(2.25, 9)
    expect(v).toBeCloseTo(-1.5, 9)
  })

  it('hit-tests the stretched cell correctly (cell (0,1) at 0.5x)', () => {
    // Cell (0,1) spans screen y [300 + 1*15, 300 + 2*15] = [315, 330]; its center must resolve to v=1.
    const [u, v] = s2w(415, 322.5, size, pan, ZOOM, 0.5)
    expect(Math.floor(u)).toBe(0)
    expect(Math.floor(v)).toBe(1)
  })

  it('1x clamps pan exactly as today', () => {
    expect(clamp({ x: 0, y: -1000 }, size, ZOOM, 8)).toEqual(clamp({ x: 0, y: -1000 }, size, ZOOM, 8, 1))
  })

  it('clamp range accounts for the stretched v axis', () => {
    // Y bounds are computed in scaled px but pan stays in grid units: minY = (100-300)/15 - 8.
    const out = clamp({ x: 0, y: -1000 }, size, ZOOM, 8, 0.5)
    expect(out.y).toBeCloseTo((100 - 300) / (BASE_CELL_PX * 0.5) - 8, 9)
  })
})

describe('defaultZoomForExtent v-scale fit', () => {
  it('1x frames exactly as today', () => {
    expect(defaultZoomForExtent(16)).toBe(defaultZoomForExtent(16, 1))
  })

  it('tall volumes zoom out to fit their height (2x on 16 frames like 1x on 32)', () => {
    expect(defaultZoomForExtent(16, 2)).toBe(defaultZoomForExtent(32, 1))
  })

  it('flat volumes keep the width fit (0.5x frames like 1x)', () => {
    expect(defaultZoomForExtent(16, 0.5)).toBe(defaultZoomForExtent(16, 1))
  })
})
