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
    expect(useAppStore.getState().plane).toEqual({ axis: 'y', orientation: 1, offset: -4 })
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
    expect(after.plane).toEqual({ axis: 'y', orientation: 1, offset: -8 })
    expect(after.objectModeTarget).toBeNull()
  })

  it('grounds relative to a resized project', () => {
    useAppStore.getState().newProject('Small', 8)
    useAppStore.getState().setPlaneAxisOrientation('z', 1)
    useAppStore.getState().setPlaneOffset(3)

    useAppStore.getState().resetPlaneToGround()

    expect(useAppStore.getState().plane).toEqual({ axis: 'y', orientation: 1, offset: -4 })
  })
})
