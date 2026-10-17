import { beforeEach, describe, expect, it } from 'vitest'
import { encodeKey } from '@/engine/grid/GridStore'
import { gridCoordFromPixel } from '@/engine/plane/constructionPlane'
import { cloneTextureModel } from '@/engine/texture/TextureStore'
import { EMPTY, faceSizeFor } from '@/engine/texture/types'
import type { BoxFace } from '@/engine/texture/types'
import { rectRegion } from '@/engine/tools/selectionMask'
import { useAppStore } from './useAppStore'

const PLANE = { axis: 'z' as const, orientation: 1 as const, offset: 0 }
const keyFor = (u: number, v: number) => encodeKey(...gridCoordFromPixel(PLANE, u, v))
const SLOT_A = { kind: 'base', index: 0 } as const

function paintCells(cells: Array<readonly [number, number]>) {
  const s = useAppStore.getState()
  s.beginStroke()
  for (const [u, v] of cells) s.paintCell(u, v)
  s.commitStroke()
}

/** Whole-model transforms (`transformWholeModel`): select-all + deep-lift + transform + bake as
 * one undo step, with no selection left behind. */
describe('transformWholeModel', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.newProject('Test', 16)
    s.setMode('model')
    s.setActiveVoxelKind('cube')
    s.setActivePaletteSlot(SLOT_A)
    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.setSelection(null)
  })

  it('rotates every cell clockwise about the grid origin as one undo step', () => {
    // 16-wide box: origin (-8,-8), du = u+8, dv = v+8; cw maps (du,dv) -> (15-dv, du).
    paintCells([[2, 3], [2, 4]])
    const pastBefore = useAppStore.getState().past.length

    useAppStore.getState().transformWholeModel('rotate')

    const after = useAppStore.getState()
    // (2,3): du=10,dv=11 -> du'=4,dv'=10 -> (-4,2). (2,4): du=10,dv=12 -> (-5,2).
    expect(after.model.color.get(keyFor(-4, 2))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.get(keyFor(-5, 2))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.has(keyFor(2, 3))).toBe(false)
    expect(after.model.color.has(keyFor(2, 4))).toBe(false)
    expect(after.past.length).toBe(pastBefore + 1)
    expect(after.selection).toBeNull()
    expect(after.floatContent).toBeNull()
  })

  it('mirrors horizontally about the grid center', () => {
    paintCells([[2, 3]])
    useAppStore.getState().transformWholeModel('mirror-h')

    const after = useAppStore.getState()
    // du=10 -> du'=15-10=5 -> u'=-3, v unchanged.
    expect(after.model.color.get(keyFor(-3, 3))?.paletteSlot).toEqual(SLOT_A)
    expect(after.model.color.has(keyFor(2, 3))).toBe(false)
    expect(after.selection).toBeNull()
  })

  it('renumbers chamfer shapes with the rotation', () => {
    const s = useAppStore.getState()
    s.setActiveVoxelKind('ramp')
    // C=(5,5) sees W+N -> convex rotation 1 (same corner as the bevel drag test).
    s.beginStroke()
    s.paintCell(4, 5)
    s.paintCell(5, 4)
    s.paintCell(5, 5)
    s.commitStroke()
    expect(useAppStore.getState().model.chamfer.get(keyFor(5, 5))!.resolvedTo).toEqual({
      shapeKind: 'convex',
      rotation: 1,
    })

    useAppStore.getState().transformWholeModel('rotate')

    const after = useAppStore.getState()
    // C: du=13,dv=13 -> du'=2,dv'=13 -> (-6,5); cw renumbers convex 1 -> 2.
    expect(after.model.color.has(keyFor(-6, 5))).toBe(true)
    expect(after.model.chamfer.get(keyFor(-6, 5))!.resolvedTo).toEqual({
      shapeKind: 'convex',
      rotation: 2,
    })
    expect(after.model.color.has(keyFor(5, 5))).toBe(false)
  })

  it('carries a cross-axis bevel onto its turned face (x-baked ramp rotated about z)', () => {
    // Paint N/E/S cubes + a ramp center on the x/1/0 plane: the center sees 3 sides open-W,
    // i.e. ramp-2 baked on (x,1). Rotating the whole model cw about z must move the bevel's
    // basis with its voxels — (x,1,ramp-2) -> (y,-1,ramp-3) — not leave it bevelling the old way.
    const s = useAppStore.getState()
    s.setPlaneAxisOrientation('x', 1)
    s.setPlaneOffset(0)
    s.setActiveVoxelKind('cube')
    s.beginStroke()
    s.paintCell(0, -2) // N neighbor -> [0,1,-1]
    s.paintCell(1, -1) // E neighbor -> [0,0,-2]
    s.paintCell(0, 0) // S neighbor -> [0,-1,-1]
    s.commitStroke()
    s.setActiveVoxelKind('ramp')
    s.beginStroke()
    s.paintCell(0, -1) // center -> [0,0,-1]
    s.commitStroke()
    expect(useAppStore.getState().model.chamfer.get(encodeKey(0, 0, -1))).toEqual({
      planeAxis: 'x',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'ramp', rotation: 2 },
    })

    s.setPlaneAxisOrientation('z', 1)
    s.setPlaneOffset(0)
    s.transformWholeModel('rotate')

    const after = useAppStore.getState()
    // Rigid cw turn about z in the z frame, keeping depths: (u,v)=(0,-1)->(0,0),
    // (0,-2)->(1,0), (0,0)->(-1,0); depths stay -1 (center/N/S) and -2 (E).
    expect(after.model.color.has(encodeKey(0, -1, -1))).toBe(true) // center, depth -1
    expect(after.model.color.has(encodeKey(0, -1, -2))).toBe(true) // E cube, depth -2
    expect(after.model.color.has(encodeKey(1, -1, -1))).toBe(true) // N cube
    expect(after.model.color.has(encodeKey(-1, -1, -1))).toBe(true) // S cube
    expect(after.model.color.has(encodeKey(0, 0, -1))).toBe(false) // old center gone
    expect(after.model.chamfer.get(encodeKey(0, -1, -1))).toEqual({
      planeAxis: 'y',
      planeOrientation: -1,
      resolvedTo: { shapeKind: 'ramp', rotation: 3 },
    })
    expect(after.selection).toBeNull()
  })

  it('is a safe no-op on an empty model (no undo step)', () => {
    const pastBefore = useAppStore.getState().past.length
    useAppStore.getState().transformWholeModel('rotate')
    const after = useAppStore.getState()
    expect(after.model.color.size).toBe(0)
    expect(after.past.length).toBe(pastBefore)
    expect(after.selection).toBeNull()
  })

  it('does nothing outside model mode', () => {
    paintCells([[2, 3]])
    const pastBefore = useAppStore.getState().past.length
    useAppStore.getState().setMode('texture')
    useAppStore.getState().transformWholeModel('rotate')

    const after = useAppStore.getState()
    expect(after.model.color.has(keyFor(2, 3))).toBe(true)
    expect(after.past.length).toBe(pastBefore)
  })
})

const FACE_SIZE = faceSizeFor(16) // default texel scale on a fresh 16-project

function setupModelWithTexture() {
  const s = useAppStore.getState()
  s.newProject('Test', 16)
  s.setMode('model')
  s.setActiveVoxelKind('cube')
  s.setActivePaletteSlot(SLOT_A)
  s.setPlaneAxisOrientation('z', 1)
  s.setPlaneOffset(0)
  s.setSelection(null)
}

function paintTexels(writes: Array<readonly [BoxFace, number, number, number]>) {
  const s = useAppStore.getState()
  const next = cloneTextureModel(s.texture)
  for (const [face, u, v, value] of writes) next.faces[face][v * FACE_SIZE + u] = value
  s.setTexture(next)
}

/** Whole-model Move drags carry the box-mapped texture (wrapped); slice drags don't. */
describe('whole-model move carries the texture', () => {
  beforeEach(() => {
    setupModelWithTexture()
    paintCells([[2, 3]])
    paintTexels([['pz', 10, 20, 3], ['pz', FACE_SIZE - 1, 20, 4]])
  })

  it('shifts texels with the voxels and wraps around, as one texture-undo step', () => {
    const before = useAppStore.getState()
    const texBefore = before.texture
    const texturePastBefore = before.texturePast.length
    // z-plane du=1 -> world +x -> pz shifts +u by one voxel = 4 texels.
    before.beginMove(true)
    useAppStore.getState().updateMove(1, 0)
    useAppStore.getState().endMove()

    const after = useAppStore.getState()
    expect(after.texture.faces.pz[20 * FACE_SIZE + 14]).toBe(3)
    expect(after.texture.faces.pz[20 * FACE_SIZE + 10]).toBe(EMPTY)
    // (63,20) + 4 texels wraps to (3,20).
    expect(after.texture.faces.pz[20 * FACE_SIZE + 3]).toBe(4)
    expect(after.texture.faces.pz[20 * FACE_SIZE + (FACE_SIZE - 1)]).toBe(EMPTY)
    // Voxels moved too, and both histories grew by one.
    expect(after.model.color.has(keyFor(2, 3))).toBe(false)
    expect(after.texturePast.length).toBe(texturePastBefore + 1)
    expect(after.texture).not.toBe(texBefore)
  })

  it('leaves the texture reference-identical on slice (non-whole-model) moves', () => {
    const texBefore = useAppStore.getState().texture
    const texturePastBefore = useAppStore.getState().texturePast.length
    useAppStore.getState().beginMove(false)
    useAppStore.getState().updateMove(1, 0)
    useAppStore.getState().endMove()

    const after = useAppStore.getState()
    expect(after.texture).toBe(texBefore)
    expect(after.texturePast.length).toBe(texturePastBefore)
  })

  it('records no texture history on a click-without-drag', () => {
    const texBefore = useAppStore.getState().texture
    const texturePastBefore = useAppStore.getState().texturePast.length
    useAppStore.getState().beginMove(true)
    useAppStore.getState().endMove()

    const after = useAppStore.getState()
    expect(after.texture).toBe(texBefore)
    expect(after.texturePast.length).toBe(texturePastBefore)
  })

  it('leaves the texture alone when a voxel selection is active', () => {
    const texBefore = useAppStore.getState().texture
    const texturePastBefore = useAppStore.getState().texturePast.length
    useAppStore.getState().setSelection(rectRegion(0, 0, 1, 1))
    useAppStore.getState().beginMove(true)
    useAppStore.getState().updateMove(1, 0)
    useAppStore.getState().endMove()

    const after = useAppStore.getState()
    expect(after.texture).toBe(texBefore)
    expect(after.texturePast.length).toBe(texturePastBefore)
  })
})

/** Whole-model rotates/mirrors permute the texture's box faces as one texture-undo step. */
describe('transformWholeModel carries the texture', () => {
  beforeEach(() => {
    setupModelWithTexture()
    paintCells([[2, 3]])
  })

  it('moves the py face onto px on a z-plane cw rotate', () => {
    const s = useAppStore.getState()
    const next = cloneTextureModel(s.texture)
    next.faces.py.fill(3)
    s.setTexture(next)
    const texturePastBefore = useAppStore.getState().texturePast.length

    useAppStore.getState().transformWholeModel('rotate')

    const after = useAppStore.getState()
    expect(after.texture.faces.px.every((t) => t === 3)).toBe(true)
    expect(after.texture.faces.py.every((t) => t === EMPTY)).toBe(true)
    expect(after.texturePast.length).toBe(texturePastBefore + 1)
    expect(after.selection).toBeNull()
  })

  it('skips the texture when a voxel selection is active (voxels still transform)', () => {
    const s = useAppStore.getState()
    const next = cloneTextureModel(s.texture)
    next.faces.py.fill(3)
    s.setTexture(next)
    const texBefore = useAppStore.getState().texture
    const texturePastBefore = useAppStore.getState().texturePast.length
    useAppStore.getState().setSelection(rectRegion(0, 0, 1, 1))

    useAppStore.getState().transformWholeModel('rotate')

    const after = useAppStore.getState()
    expect(after.texture).toBe(texBefore)
    expect(after.texturePast.length).toBe(texturePastBefore)
    // The voxel transform itself still ran (moved off its start cell, no selection left).
    expect(after.model.color.has(keyFor(2, 3))).toBe(false)
    expect(after.selection).toBeNull()
  })

  it('records no texture history when the texture is unpainted', () => {
    const texturePastBefore = useAppStore.getState().texturePast.length
    const pastBefore = useAppStore.getState().past.length
    useAppStore.getState().transformWholeModel('rotate')

    const after = useAppStore.getState()
    expect(after.texturePast.length).toBe(texturePastBefore)
    expect(after.past.length).toBe(pastBefore + 1)
  })
})
