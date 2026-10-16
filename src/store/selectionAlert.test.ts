import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { rectRegion } from '@/engine/tools/selectionMask'
import { SELECTION_BLOCKED_MESSAGE } from './viewSlice'
import { useAppStore } from './useAppStore'

const PLANE = { axis: 'z' as const, orientation: 1 as const, offset: 0 }
const keyFor = (u: number, v: number) => encodeKey(...gridCoordFromPixel(PLANE, u, v))

/** Drives the real store to verify the footer selection-blocked alert: every 2D edit rejected
 * by the selection clip flashes it (message + blink key), and it clears on the next stroke,
 * on selection change, or by timeout. */
describe('selection-blocked footer alert (voxel 2D)', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveVoxelKind('cube')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.clearStatusAlert()
  })

  afterEach(() => {
    useAppStore.getState().clearStatusAlert()
    vi.useRealTimers()
  })

  it('flashes on paint outside the selection, with a fresh blink key per offense', () => {
    const s = useAppStore.getState()
    s.setSelection(rectRegion(0, 0, 0, 0)) // single voxel selected elsewhere

    expect(s.paintCell(4, 4)).toBe(false)
    let alert = useAppStore.getState().statusAlert
    expect(alert?.message).toBe(SELECTION_BLOCKED_MESSAGE)
    const firstKey = alert!.key

    useAppStore.getState().paintCell(5, 5)
    alert = useAppStore.getState().statusAlert
    expect(alert?.message).toBe(SELECTION_BLOCKED_MESSAGE)
    expect(alert!.key).toBeGreaterThan(firstKey)
    // Nothing was painted either time.
    expect(useAppStore.getState().model.color.size).toBe(0)
  })

  it('flashes on erase, material repaint, rebase, and fill outside the selection', () => {
    const s = useAppStore.getState()
    s.setSelection(rectRegion(0, 0, 0, 0))
    // Seed one voxel so erase/material have something to hit (still outside the selection).
    s.setSelection(null)
    s.beginStroke()
    s.paintCell(4, 4)
    s.commitStroke()
    s.setSelection(rectRegion(0, 0, 0, 0))

    useAppStore.getState().eraseCell([...gridCoordFromPixel(PLANE, 4, 4)] as [number, number, number])
    expect(useAppStore.getState().statusAlert?.message).toBe(SELECTION_BLOCKED_MESSAGE)
    expect(useAppStore.getState().model.color.has(keyFor(4, 4))).toBe(true) // not erased

    expect(useAppStore.getState().paintMaterialCell(4, 4)).toBe(false)
    expect(useAppStore.getState().statusAlert?.message).toBe(SELECTION_BLOCKED_MESSAGE)

    expect(useAppStore.getState().rebaseRampCell(4, 4)).toBe(false)
    expect(useAppStore.getState().statusAlert?.message).toBe(SELECTION_BLOCKED_MESSAGE)

    // Empty plane, click outside the 1px selection: leak-guard rejects a whole-plane fill.
    useAppStore.getState().floodFill(5, 5)
    expect(useAppStore.getState().statusAlert?.message).toBe(SELECTION_BLOCKED_MESSAGE)
    expect(useAppStore.getState().model.color.size).toBe(1) // only the seed voxel
  })

  it('stays quiet without a selection, and clears on the next stroke', () => {
    const s = useAppStore.getState()
    s.setSelection(rectRegion(0, 0, 0, 0))
    s.paintCell(4, 4)
    expect(useAppStore.getState().statusAlert).not.toBeNull()

    // A new stroke (pointer down) dismisses it; the successful paint doesn't re-flash.
    useAppStore.getState().beginStroke()
    expect(useAppStore.getState().statusAlert).toBeNull()
    useAppStore.getState().paintCell(0, 0)
    useAppStore.getState().commitStroke()
    expect(useAppStore.getState().statusAlert).toBeNull()
    expect(useAppStore.getState().model.color.has(keyFor(0, 0))).toBe(true)
  })

  it('clears when the selection changes', () => {
    const s = useAppStore.getState()
    s.setSelection(rectRegion(0, 0, 0, 0))
    s.paintCell(4, 4)
    expect(useAppStore.getState().statusAlert).not.toBeNull()

    // Acting on the message (Esc clears via setSelection(null)) dismisses the alert.
    useAppStore.getState().setSelection(null)
    expect(useAppStore.getState().statusAlert).toBeNull()
  })

  it('auto-clears after the timeout, ignoring stale generations', () => {
    vi.useFakeTimers()
    const s = useAppStore.getState()
    s.setSelection(rectRegion(0, 0, 0, 0))

    s.paintCell(4, 4)
    const firstKey = useAppStore.getState().statusAlert!.key
    // A second offense before expiry re-arms the timer for its own generation.
    vi.advanceTimersByTime(1000)
    s.paintCell(5, 5)
    expect(useAppStore.getState().statusAlert!.key).toBeGreaterThan(firstKey)

    // Past the first deadline but within the second's: still showing.
    vi.advanceTimersByTime(2000)
    expect(useAppStore.getState().statusAlert).not.toBeNull()
    // Past the second deadline: gone.
    vi.advanceTimersByTime(1000)
    expect(useAppStore.getState().statusAlert).toBeNull()
  })
})

describe('selection-blocked footer alert (texture 2D)', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setActiveBoxFace('pz')
    s.setActiveGrayIndex(2)
    s.clearStatusAlert()
  })

  afterEach(() => {
    useAppStore.getState().clearStatusAlert()
    vi.useRealTimers()
  })

  it('flashes on texel paint and fill outside the texel selection', () => {
    const s = useAppStore.getState()
    // Seed one gray texel first (no selection yet), so the fill below has a bounded region
    // that cannot intersect the selection at all.
    s.paintTexel(5, 5)
    expect(useAppStore.getState().statusAlert).toBeNull()

    s.setTextureSelection(rectRegion(0, 0, 0, 0))

    s.paintTexel(4, 4)
    expect(useAppStore.getState().statusAlert?.message).toBe(SELECTION_BLOCKED_MESSAGE)

    // The gray region {(5,5)} filters down to nothing against the selection → rejected.
    s.floodFillTexel(5, 5)
    expect(useAppStore.getState().statusAlert?.message).toBe(SELECTION_BLOCKED_MESSAGE)
  })

  it('stays quiet for in-selection texel work and clears with the selection', () => {
    const s = useAppStore.getState()
    s.setTextureSelection(rectRegion(0, 0, 2, 2))
    s.paintTexel(1, 1)
    expect(useAppStore.getState().statusAlert).toBeNull()

    s.paintTexel(4, 4)
    expect(useAppStore.getState().statusAlert).not.toBeNull()
    s.setTextureSelection(null)
    expect(useAppStore.getState().statusAlert).toBeNull()
  })
})
