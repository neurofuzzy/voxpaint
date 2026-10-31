import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

/** Animate and Texture modes edit on the 2D canvas — 3D-only has no editing surface there,
 * so both mode switches and layout requests pin those modes to split. */
describe('mode/layout invariant', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setMode('model')
    s.setLayoutMode('split')
  })

  it('leaving model mode drops back to split', () => {
    useAppStore.getState().setLayoutMode('3d-only')
    expect(useAppStore.getState().layoutMode).toBe('3d-only')

    useAppStore.getState().setMode('animate')
    expect(useAppStore.getState().mode).toBe('animate')
    expect(useAppStore.getState().layoutMode).toBe('split')

    useAppStore.getState().setLayoutMode('3d-only')
    useAppStore.getState().setMode('texture')
    expect(useAppStore.getState().layoutMode).toBe('split')
  })

  it('3d-only requests outside model mode land on split', () => {
    useAppStore.getState().setMode('animate')
    useAppStore.getState().setLayoutMode('3d-only')
    expect(useAppStore.getState().layoutMode).toBe('split')

    useAppStore.getState().setMode('texture')
    useAppStore.getState().setLayoutMode('3d-only')
    expect(useAppStore.getState().layoutMode).toBe('split')
  })

  it('model mode keeps whatever layout it is given', () => {
    useAppStore.getState().setMode('model')
    useAppStore.getState().setLayoutMode('3d-only')
    expect(useAppStore.getState().layoutMode).toBe('3d-only')

    // A round-trip through animate restores Model's own layout, not split.
    useAppStore.getState().setMode('animate')
    expect(useAppStore.getState().layoutMode).toBe('split')
    useAppStore.getState().setMode('model')
    expect(useAppStore.getState().layoutMode).toBe('3d-only')
  })
})

/** Model's layout is remembered across tab switches: leaving for Animate/Texture parks the
 * live layout in split, and coming back restores what Model had. */
describe('model layout memory', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setMode('model')
    s.setLayoutMode('split')
  })

  it('restores 3d-only when returning to model', () => {
    useAppStore.getState().setLayoutMode('3d-only')

    useAppStore.getState().setMode('animate')
    expect(useAppStore.getState().layoutMode).toBe('split')

    useAppStore.getState().setMode('model')
    expect(useAppStore.getState().layoutMode).toBe('3d-only')

    useAppStore.getState().setMode('texture')
    expect(useAppStore.getState().layoutMode).toBe('split')

    useAppStore.getState().setMode('model')
    expect(useAppStore.getState().layoutMode).toBe('3d-only')
  })

  it('tracks layout changes made while in model mode', () => {
    useAppStore.getState().setLayoutMode('3d-only')
    // Back to split while still modeling — that (not 3d-only) is what comes back.
    useAppStore.getState().setLayoutMode('split')

    useAppStore.getState().setMode('animate')
    useAppStore.getState().setMode('model')
    expect(useAppStore.getState().layoutMode).toBe('split')
  })

  it('deflected requests outside model mode do not clobber the memory', () => {
    useAppStore.getState().setLayoutMode('3d-only')
    useAppStore.getState().setMode('animate')
    // No collapse button exists here, but any other caller deflects the same way.
    useAppStore.getState().setLayoutMode('3d-only')
    expect(useAppStore.getState().layoutMode).toBe('split')

    useAppStore.getState().setMode('model')
    expect(useAppStore.getState().layoutMode).toBe('3d-only')
  })
})

/** Animate panel tabs own the toolbar: switching tabs arms that tab's primary tool, and
 * entering Animate mode lands on the tab matching the current tool (rigbox default). */
describe('animate tab/tool sync', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setMode('model')
    s.setActiveTool('paint')
  })

  it('entering animate from an unwired tool lands on rig + rigbox', () => {
    const s = useAppStore.getState()
    s.setActiveTool('move')
    s.setMode('animate')
    expect(useAppStore.getState().animateTab).toBe('rig')
    expect(useAppStore.getState().activeTool).toBe('rigbox')
  })

  it('entering animate with select lands on the tweens tab', () => {
    const s = useAppStore.getState()
    s.setActiveTool('select')
    s.setMode('animate')
    expect(useAppStore.getState().animateTab).toBe('tweens')
    expect(useAppStore.getState().activeTool).toBe('select')
  })

  it('entering animate keeps a wired tool and matches its tab', () => {
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    s.setActiveTool('pose')
    s.setMode('animate')
    expect(useAppStore.getState().animateTab).toBe('poses')
    expect(useAppStore.getState().activeTool).toBe('pose')
  })

  it('entering animate with a pose tool in a tweens project lands on tweens + select', () => {
    const s = useAppStore.getState()
    s.setAnimationMode('tweens')
    s.setActiveTool('pose')
    s.setMode('animate')
    expect(useAppStore.getState().animateTab).toBe('tweens')
    expect(useAppStore.getState().activeTool).toBe('select')
  })

  it('switching tabs arms the tab tool', () => {
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    s.setMode('animate')
    s.setAnimateTab('tweens')
    // Tweens is hidden in a poses project — maps to the visible poses tab.
    expect(useAppStore.getState().animateTab).toBe('poses')
    expect(useAppStore.getState().activeTool).toBe('pose')
    s.setAnimateTab('rig')
    expect(useAppStore.getState().activeTool).toBe('rigbox')
    s.setAnimationMode('tweens')
    s.setAnimateTab('tweens')
    expect(useAppStore.getState().activeTool).toBe('select')
  })

  it('re-clicking the active tab keeps an explicitly chosen tool', () => {
    const s = useAppStore.getState()
    s.setMode('animate')
    s.setAnimateTab('rig')
    s.setActiveTool('pivot')
    s.setAnimateTab('rig')
    expect(useAppStore.getState().activeTool).toBe('pivot')
  })
})
