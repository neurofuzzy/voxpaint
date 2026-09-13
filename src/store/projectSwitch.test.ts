import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

/** Project switches (new/import) must not leak selection, pending floats, hover, open undo
 * strokes, or histories from the old project into the fresh one. */
describe('project switch hygiene', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('newProject discards a pending float so later undo cannot resurrect the old model', () => {
    const s = useAppStore.getState()
    // Committed voxel A, then lift it (opens a stroke, clears the source, floats A).
    s.beginStroke()
    s.paintCellAtCoord([0, 0, 0], 'z', 1)
    s.commitStroke()
    // (u,v) = (0,-1) on z/1/offset-0 is exactly [0,0,0].
    s.setSelection({ originU: 0, originV: -1, width: 1, height: 1, mask: new Uint8Array([1]) })
    s.liftSelectionToFloat()
    expect(useAppStore.getState().floatContent).not.toBeNull()
    expect(useAppStore.getState().model.color.size).toBe(0)

    useAppStore.getState().newProject('Fresh', 16)

    const after = useAppStore.getState()
    expect(after.selection).toBeNull()
    expect(after.floatContent).toBeNull()
    expect(after.floatOrigin).toBeNull()
    expect(after.past).toEqual([])

    // The dangling baseline must be gone: undo here is a clean no-op, not a resurrection.
    after.undo()
    expect(useAppStore.getState().model.color.size).toBe(0)
  })

  it('newProject clears hover state', () => {
    const s = useAppStore.getState()
    s.setHoverCell([0, 0, 0], null)
    s.setHoveredFace({ cellKey: '0,0,0', axis: 'z', orientation: 1 })

    useAppStore.getState().newProject('Fresh', 16)

    const after = useAppStore.getState()
    expect(after.hoverCell).toBeNull()
    expect(after.hoveredFace).toBeNull()
  })

  it('newProject clears the texture selection', () => {
    const s = useAppStore.getState()
    s.setTextureSelection({ originU: 0, originV: 0, width: 2, height: 2, mask: new Uint8Array([1, 1, 1, 1]) })

    useAppStore.getState().newProject('Fresh', 16)

    expect(useAppStore.getState().textureSelection).toBeNull()
  })
})
