import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import type { Axis, Coord, Orientation, Rotation } from '@/engine/grid/types'
import { poolIdFor } from '@/engine/instancing/pools'
import { useAppStore } from './useAppStore'
import { resolveGhostPlacement } from './ghostPlacement'
import type { ToolId, VoxelKind } from './types'

/**
 * Differential test: the ghost preview must resolve exactly what the paint write produces.
 * `resolveGhostPlacement` (ghost + HUD) and `paintCellAtCoord` (3D tap) share the same contract
 * — any row failing here is a preview-lies bug, not a hover-staleness artifact.
 */
function setup(kind: VoxelKind, brush: Rotation, tool: ToolId = 'paint') {
  const s = useAppStore.getState()
  s.newProject('Test', 16)
  s.setActiveVoxelKind(kind)
  s.setBrushRotation(brush)
  s.setActiveTool(tool)
  s.setEdit3D(false)
  s.setPlaneAxisOrientation('z', 1)
  s.setPlaneOffset(0)
}

function paintCubeNeighbor(coord: Coord) {
  const prev = useAppStore.getState().activeVoxelKind
  const s = useAppStore.getState()
  s.setActiveVoxelKind('cube')
  s.beginStroke()
  expect(s.paintCellAtCoord(coord, 'z', 1)).toBe(true)
  s.commitStroke()
  useAppStore.getState().setActiveVoxelKind(prev)
}

/** Ghost in the active-plane frame (no face): deterministic regardless of pointer state. */
function ghostFor(target: Coord, axis: Axis = 'z', orientation: Orientation = 1) {
  // NB: re-fetch state AFTER the plane set — zustand replaces the state object on set(), so a
  // snapshot captured before would read the stale plane.
  useAppStore.getState().setPlaneAxisOrientation(axis, orientation)
  const s = useAppStore.getState()
  return resolveGhostPlacement({
    model: s.model,
    plane: s.plane,
    hoverCell: target,
    hoveredFace: null,
    activeVoxelKind: s.activeVoxelKind,
    brushRotation: s.brushRotation,
    activeTool: s.activeTool,
    edit3D: false,
    gridExtent: s.meta.gridExtent,
    layoutMode: s.layoutMode,
  })
}

function paintAt(target: Coord, axis: Axis = 'z', orientation: Orientation = 1) {
  const s = useAppStore.getState()
  s.beginStroke()
  expect(s.paintCellAtCoord(target, axis, orientation)).toBe(true)
  s.commitStroke()
  return useAppStore.getState().model.chamfer.get(encodeKey(...target))
}

describe('ghost vs paintCellAtCoord agreement', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setLayoutMode('split')
  })

  it('lone wedge: fallback rotation honors brush', () => {
    setup('wedge', 2)
    const target: Coord = [0, 0, 0]
    expect(ghostFor(target)?.kind).toBe('chamfer')
    expect(paintAt(target)?.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: 2 })
  })

  it('wedge completing a convex corner (E+S filled) matches rotation', () => {
    setup('wedge', 1)
    paintCubeNeighbor([1, 0, 0])
    paintCubeNeighbor([0, 1, 0])
    const target: Coord = [0, 0, 0]
    const placement = ghostFor(target)
    const written = paintAt(target)
    // NB: the z-plane's v axis runs along −y, so grid neighbor (0,1,0) is plane-North: filled
    // E+N -> convex rotation 2, plus brush 1 -> wedge rotation 3.
    expect(written?.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: 3 })
    expect(placement?.kind).toBe('chamfer')
  })

  it('ramp with 3 neighbors matches incl. brush offset', () => {
    setup('ramp', 1)
    paintCubeNeighbor([1, 0, 0])
    paintCubeNeighbor([-1, 0, 0])
    paintCubeNeighbor([0, 1, 0])
    const target: Coord = [0, 0, 0]
    expect(ghostFor(target)?.kind).toBe('chamfer')
    expect(paintAt(target)?.resolvedTo?.shapeKind).toBe('ramp')
  })

  it('unresolved ramp shows cube ghost and paints unresolved', () => {
    setup('ramp', 0)
    const target: Coord = [0, 0, 0]
    expect(ghostFor(target)?.kind).toBe('cube')
    expect(paintAt(target)?.resolvedTo).toBeNull()
  })

  it('explicit convex/concave match at brush rotation', () => {
    for (const kind of ['convex', 'concave'] as const) {
      setup(kind, 3)
      const target: Coord = [2, 2, 0]
      expect(ghostFor(target)?.kind).toBe('chamfer')
      expect(paintAt(target)?.resolvedTo).toEqual({ shapeKind: kind, rotation: 3 })
    }
  })

  it('ghost pool equals the written cell instance pool (mirror-aware)', () => {
    for (const [axis, orientation] of [['z', 1], ['z', -1], ['x', 1], ['y', -1]] as Array<[Axis, Orientation]>) {
      setup('convex', 2)
      const target: Coord = [1, 1, 0]
      const placement = ghostFor(target, axis, orientation)
      const written = paintAt(target, axis, orientation)
      expect(placement?.kind).toBe('chamfer')
      if (placement?.kind === 'chamfer') {
        expect(placement.pool).toBe(poolIdFor(written))
      }
    }
  })
})

/** 3D-only mode is verbatim: no adjacency classification, no end-of-stroke correction. */
describe('verbatim paint in 3d-only mode', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setLayoutMode('3d-only')
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('ramp ignores neighbors and paints the brush rotation', () => {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('ramp')
    s.setBrushRotation(1)
    s.setActiveTool('paint')
    // N+E+S filled: autotile would resolve a ramp (open W) at rotation 2 — verbatim must not.
    paintCubeNeighbor([0, -1, 0])
    paintCubeNeighbor([1, 0, 0])
    paintCubeNeighbor([0, 1, 0])
    const target: Coord = [0, 0, 0]
    expect(ghostFor(target)?.kind).toBe('chamfer')
    expect(paintAt(target)?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 1 })
  })

  it('wedge ignores a convex corner match and paints the brush rotation', () => {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('wedge')
    s.setBrushRotation(0)
    s.setActiveTool('paint')
    // E+S filled: autotile would match convex rotation 3 — verbatim paints fallback 0.
    paintCubeNeighbor([1, 0, 0])
    paintCubeNeighbor([0, 1, 0])
    const target: Coord = [0, 0, 0]
    expect(ghostFor(target)?.kind).toBe('chamfer')
    expect(paintAt(target)?.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: 0 })
  })

  it('lone ramp resolves immediately (no cube fallback, no correction pass)', () => {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('ramp')
    s.setBrushRotation(3)
    s.setActiveTool('paint')
    const target: Coord = [0, 0, 0]
    expect(ghostFor(target)?.kind).toBe('chamfer')
    expect(paintAt(target)?.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 3 })
    // The correction pass is a no-op in 3d-only: the verbatim cell is untouched.
    s.correctChamferStroke()
    expect(useAppStore.getState().model.chamfer.get(encodeKey(...target))?.resolvedTo).toEqual({
      shapeKind: 'ramp',
      rotation: 3,
    })
  })

  it('ghost pool matches the verbatim write on every axis', () => {
    for (const [axis, orientation] of [['z', 1], ['z', -1], ['x', 1], ['y', -1]] as Array<[Axis, Orientation]>) {
      const s = useAppStore.getState()
      s.newProject('Test', 16)
      s.setLayoutMode('3d-only')
      s.setActiveVoxelKind('wedge')
      s.setBrushRotation(2)
      s.setActiveTool('paint')
      const target: Coord = [1, 1, 0]
      const placement = ghostFor(target, axis, orientation)
      const written = paintAt(target, axis, orientation)
      expect(written?.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: 2 })
      if (placement?.kind === 'chamfer') {
        expect(placement.pool).toBe(poolIdFor(written))
      } else {
        expect.unreachable('verbatim wedge ghost must be a chamfer')
      }
    }
  })
})

/**
 * Orientation ALWAYS inherits the active construction plane, never the raycast face: tapping a
 * voxel's east (+x) face with the plane on z paints the x+1 neighbor authored in the z frame —
 * exactly what the brush preview shows.
 */
describe('orientation inherits the construction plane, never the raycast face', () => {
  function facePlacement() {
    const s = useAppStore.getState()
    return resolveGhostPlacement({
      model: s.model,
      plane: s.plane,
      hoverCell: [0, 0, 0],
      hoveredFace: { cellKey: encodeKey(0, 0, 0), axis: 'x' as const, orientation: 1 as const },
      activeVoxelKind: s.activeVoxelKind,
      brushRotation: s.brushRotation,
      activeTool: 'paint',
      edit3D: true,
      gridExtent: s.meta.gridExtent,
      layoutMode: s.layoutMode,
    })
  }

  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setLayoutMode('split')
    s.setActiveVoxelKind('wedge')
    s.setBrushRotation(0)
    s.setActiveTool('paint')
    s.setEdit3D(true)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
  })

  it('ghost places across the hit face but resolves in the plane frame', () => {
    const placement = facePlacement()
    expect(placement?.kind).toBe('chamfer')
    if (placement?.kind !== 'chamfer') return
    // Across the east face…
    expect(placement.target).toEqual([1, 0, 0])
    // …but the pool is the z-frame (plane) pool, not the x-frame (face) pool.
    const written = paintAt([1, 0, 0], 'z', 1)
    expect(written?.planeAxis).toBe('z')
    expect(written?.planeOrientation).toBe(1)
    expect(placement.pool).toBe(poolIdFor(written))
  })

  it('verbatim 3d-only write matches the plane-frame preview', () => {
    useAppStore.getState().setLayoutMode('3d-only')
    const placement = facePlacement()
    const written = paintAt([1, 0, 0], 'z', 1)
    expect(written?.resolvedTo).toEqual({ shapeKind: 'wedge', rotation: 0 })
    expect(written?.planeAxis).toBe('z')
    if (placement?.kind === 'chamfer') {
      expect(placement.pool).toBe(poolIdFor(written))
    } else {
      expect.unreachable('verbatim wedge ghost must be a chamfer')
    }
  })
})
