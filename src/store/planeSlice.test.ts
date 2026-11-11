import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

/** The construction plane can't leave the project bounds: every move funnels through
 * `setPlaneOffset`, which pins to the working range `[-half, half)` of the even effective grid. */
describe('plane offset bounds', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('clamps above the top layer and below the bottom layer', () => {
    const s = useAppStore.getState()
    s.setPlaneOffset(100)
    expect(useAppStore.getState().plane.offset).toBe(7)
    s.setPlaneOffset(-100)
    expect(useAppStore.getState().plane.offset).toBe(-8)
  })

  it('keeps in-range offsets untouched', () => {
    const s = useAppStore.getState()
    s.setPlaneOffset(3)
    expect(useAppStore.getState().plane.offset).toBe(3)
    s.setPlaneOffset(-8)
    expect(useAppStore.getState().plane.offset).toBe(-8)
    s.setPlaneOffset(7)
    expect(useAppStore.getState().plane.offset).toBe(7)
  })

  it('uses the even effective grid for odd sizes (9 → [-5, 4])', () => {
    useAppStore.getState().newProject('Test', 9)
    const s = useAppStore.getState()
    s.setPlaneOffset(5)
    expect(useAppStore.getState().plane.offset).toBe(4)
    s.setPlaneOffset(-6)
    expect(useAppStore.getState().plane.offset).toBe(-5)
  })

  it('click-advancing past the top layer stays put', () => {
    const s = useAppStore.getState()
    s.setPlaneOffset(7)
    // First click lands the plane; the second click on the same face advances one step forward.
    s.handleVoxelFaceClick('0,0,7', 'z', 1, 7)
    s.handleVoxelFaceClick('0,0,7', 'z', 1, 7)
    expect(useAppStore.getState().plane.offset).toBe(7)
  })

  it('a new project starts grounded regardless of the old offset', () => {
    useAppStore.getState().setPlaneOffset(7)
    useAppStore.getState().newProject('Small', 8)
    expect(useAppStore.getState().plane).toEqual({ axis: 'y', orientation: 1, offset: -4, half: null })
  })
})

/** The project-switch reset: one project's slice never leaks into the next. */
describe('resetPlaneToGround', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  it('grounds the plane for the current extent and clears the face-click target', () => {
    const s = useAppStore.getState()
    s.setPlaneAxisOrientation('x', -1)
    s.setPlaneOffset(5)
    s.handleVoxelFaceClick('5,0,0', 'x', -1, 5)
    expect(useAppStore.getState().objectModeTarget).not.toBeNull()

    useAppStore.getState().resetPlaneToGround()

    const after = useAppStore.getState()
    expect(after.plane).toEqual({ axis: 'y', orientation: 1, offset: -8, half: null })
    expect(after.objectModeTarget).toBeNull()
  })

  it('grounds relative to a resized project', () => {
    useAppStore.getState().newProject('Small', 8)
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(3)

    useAppStore.getState().resetPlaneToGround()

    expect(useAppStore.getState().plane).toEqual({ axis: 'y', orientation: 1, offset: -4, half: null })
  })
})

/** In Animate mode the second 3D tap selects the rig box instead of stepping the plane. */
describe('animate second-tap selects the rig', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setMode('animate')
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
  })

  function addBox(id: string, min: [number, number, number], max: [number, number, number]) {
    useAppStore.getState().addRigBox({ id, name: id, min, max, parentId: null, pivot: null })
  }

  it('selects the containing box on the second same-face tap, plane untouched', () => {
    addBox('arm', [0, 0, 0], [2, 2, 2])
    const s = useAppStore.getState()
    s.handleVoxelFaceClick('1,1,0', 'z', 1, 0)
    s.handleVoxelFaceClick('1,1,0', 'z', 1, 0)
    const after = useAppStore.getState()
    expect(after.selectedRigBoxId).toBe('arm')
    expect(after.plane.offset).toBe(0)
    expect(after.objectModeTarget).toBeNull()
  })

  it('still advances when the voxel belongs to no box', () => {
    addBox('arm', [0, 0, 0], [2, 2, 2])
    useAppStore.getState().selectRigBox(null)
    const s = useAppStore.getState()
    s.handleVoxelFaceClick('9,9,0', 'z', 1, 0)
    s.handleVoxelFaceClick('9,9,0', 'z', 1, 0)
    const after = useAppStore.getState()
    expect(after.selectedRigBoxId).toBeNull()
    expect(after.plane.offset).toBe(1)
  })

  it('a third tap re-lands instead of advancing off the selection', () => {
    addBox('arm', [0, 0, 0], [2, 2, 2])
    const s = useAppStore.getState()
    s.handleVoxelFaceClick('1,1,0', 'z', 1, 0)
    s.handleVoxelFaceClick('1,1,0', 'z', 1, 0)
    s.handleVoxelFaceClick('1,1,0', 'z', 1, 0)
    const after = useAppStore.getState()
    expect(after.selectedRigBoxId).toBe('arm')
    expect(after.plane.offset).toBe(0)
  })
})

/** Sliding the plane along its own normal keeps both selections; only a genuine reorient
 * (different axis or facing) dismisses them. See Viewport3D for the click half of this. */
describe('plane shifts keep the selection, reorients clear it', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
  })

  function seedSelections() {
    const s = useAppStore.getState()
    s.setSelection({ originU: 4, originV: 4, width: 1, height: 1, mask: new Uint8Array([1]) })
    s.setSelectedCells(new Set(['0,0,0']))
  }

  it('setPlaneOffset keeps the 2D selection and the 3D set', () => {
    const s = useAppStore.getState()
    s.beginStroke()
    expect(s.paintCell(4, 4)).toBe(true)
    s.commitStroke()
    seedSelections()

    useAppStore.getState().setPlaneOffset(1)

    const after = useAppStore.getState()
    expect(after.plane.offset).toBe(1)
    expect(after.selection).not.toBeNull()
    expect(after.selectedCells).toEqual(new Set(['0,0,0']))
  })

  it('setPlaneAxisOrientation with a real change clears both selections', () => {
    seedSelections()

    useAppStore.getState().setPlaneAxisOrientation('x', 1)

    const after = useAppStore.getState()
    expect(after.plane.axis).toBe('x')
    expect(after.selection).toBeNull()
    expect(after.selectedCells.size).toBe(0)
  })

  it('setPlaneAxisOrientation with the same facing keeps both selections', () => {
    seedSelections()

    useAppStore.getState().setPlaneAxisOrientation('z', 1)

    const after = useAppStore.getState()
    expect(after.selection).not.toBeNull()
    expect(after.selectedCells).toEqual(new Set(['0,0,0']))
  })

  it('click-advancing (same face twice) keeps the selection', () => {
    seedSelections()
    const s = useAppStore.getState()
    s.handleVoxelFaceClick('0,0,0', 'z', 1, 0)
    s.handleVoxelFaceClick('0,0,0', 'z', 1, 0)

    const after = useAppStore.getState()
    expect(after.plane.offset).toBe(1)
    expect(after.selection).not.toBeNull()
    expect(after.selectedCells).toEqual(new Set(['0,0,0']))
  })

  it('clicking a differently-faced voxel clears both selections', () => {
    seedSelections()
    useAppStore.getState().handleVoxelFaceClick('5,0,0', 'x', 1, 5)

    const after = useAppStore.getState()
    expect(after.plane.axis).toBe('x')
    expect(after.selection).toBeNull()
    expect(after.selectedCells.size).toBe(0)
  })
})

/** Half-step slab mode: face taps carry an explicit slab, advance/slide/reorient manage it. */
describe('half-step slab mode', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
  })

  it('face taps carry an explicit half slab', () => {
    useAppStore.getState().handleVoxelFaceClick('0,0,0', 'z', 1, 0, 1)
    expect(useAppStore.getState().plane).toEqual({ axis: 'z', orientation: 1, offset: 0, half: 1 })
  })

  it('omitted half stays whole-voxel', () => {
    useAppStore.getState().handleVoxelFaceClick('0,0,0', 'z', 1, 0)
    expect(useAppStore.getState().plane.half).toBeNull()
  })

  it('same-face advance exits half-step', () => {
    const s = useAppStore.getState()
    s.handleVoxelFaceClick('0,0,0', 'z', 1, 0, 1)
    expect(useAppStore.getState().plane.half).toBe(1)
    s.handleVoxelFaceClick('0,0,0', 'z', 1, 0)
    const after = useAppStore.getState()
    expect(after.plane.offset).toBe(1)
    expect(after.plane.half).toBeNull()
  })

  it('sliding the offset keeps the slab, reorienting clears it', () => {
    const s = useAppStore.getState()
    s.setPlaneHalf(1)
    s.setPlaneOffset(2)
    expect(useAppStore.getState().plane.half).toBe(1)
    s.setPlaneAxisOrientation('x', 1)
    expect(useAppStore.getState().plane.half).toBeNull()
  })

  it('flipping the facing keeps the world-frame slab', () => {
    const s = useAppStore.getState()
    s.setPlaneHalf(0)
    s.setPlaneAxisOrientation('z', -1)
    expect(useAppStore.getState().plane.half).toBe(0)
  })

  it('resetPlaneToGround clears the slab', () => {
    const s = useAppStore.getState()
    s.setPlaneHalf(1)
    s.resetPlaneToGround()
    expect(useAppStore.getState().plane.half).toBeNull()
  })
})

/** Half-voxel stepping walks whole → front slab → back slab → next whole (reversed for -1). */
describe('stepPlaneHalf', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(0)
  })

  it('steps whole → front → back → next whole forward, reversed backward', () => {
    const s = useAppStore.getState()
    // Orientation 1 views from +z: front slab is the high bit.
    s.stepPlaneHalf(1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 0, half: 1 })
    s.stepPlaneHalf(1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 0, half: 0 })
    s.stepPlaneHalf(1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 1, half: null })
    s.stepPlaneHalf(-1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 0, half: 0 })
    s.stepPlaneHalf(-1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 0, half: 1 })
    s.stepPlaneHalf(-1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 0, half: null })
    // Backward from whole drops to the previous layer's back slab.
    s.stepPlaneHalf(-1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: -1, half: 0 })
  })

  it('leads with the viewer side on flipped orientations', () => {
    const s = useAppStore.getState()
    s.setPlaneAxisOrientation('z', -1)
    // Viewed from -z: front slab is the low bit.
    s.stepPlaneHalf(1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 0, half: 0 })
    s.stepPlaneHalf(1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 0, half: 1 })
    s.stepPlaneHalf(1)
    expect(useAppStore.getState().plane).toMatchObject({ offset: 1, half: null })
  })

  it('walks multiple stops in one call and pins at the bounds', () => {
    const s = useAppStore.getState()
    s.stepPlaneHalf(1, 4)
    // (0,null) → (0,1) → (0,0) → (1,null) → (1,1).
    expect(useAppStore.getState().plane).toMatchObject({ offset: 1, half: 1 })
    // Stepping past the top layer lands whole on the top layer.
    s.stepPlaneHalf(1, 100)
    const top = useAppStore.getState().plane
    expect(top.offset).toBe(7)
    expect(top.half).toBeNull()
    // And past the bottom similarly.
    s.stepPlaneHalf(-1, 100)
    const bottom = useAppStore.getState().plane
    expect(bottom.offset).toBe(-8)
    expect(bottom.half).toBeNull()
  })
})
