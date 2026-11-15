import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { emptyTextureModel } from '@/engine/texture/TextureStore'
import type { RigBox } from '@/engine/rigging/types'
import { buildRigPoseMeshes } from './rigPoseBuild'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }

function modelWith(cells: Array<[number, number, number]>): VoxelModel {
  const model = emptyModel()
  for (const [x, y, z] of cells) model.color.set(encodeKey(x, y, z), { paletteSlot: base0 })
  return { ...model, bounds: recomputeBounds(model) }
}

function box(id: string, min: [number, number, number], max: [number, number, number]): RigBox {
  return { id, name: id, min, max, parentId: null, pivot: null }
}

const texture = emptyTextureModel(16)

describe('buildRigPoseMeshes', () => {
  it('returns null with no rig boxes or no rigged voxels', () => {
    const model = modelWith([[0, 0, 0]])
    expect(buildRigPoseMeshes(model, DEFAULT_PALETTE, texture, 16, 0, 1, [])).toBeNull()
    expect(buildRigPoseMeshes(model, DEFAULT_PALETTE, texture, 16, 0, 1, [box('a', [5, 5, 5], [6, 6, 6])])).toBeNull()
  })

  it('splits rigged voxels per box and leaves the rest static', () => {
    const model = modelWith([[0, 0, 0], [1, 0, 0], [9, 9, 9]])
    const built = buildRigPoseMeshes(model, DEFAULT_PALETTE, texture, 16, 0, 1, [box('a', [0, 0, 0], [1, 0, 0])])
    expect(built).not.toBeNull()
    // One box group (single material → single mesh), static holds the far voxel.
    expect([...built!.boxMeshes.keys()]).toEqual(['a'])
    expect(built!.boxMeshes.get('a')!.length).toBe(1)
    expect(built!.staticMeshes.length).toBe(1)
    expect(built!.materials.length).toBe(1)
  })

  it('assigns nested voxels to the deepest box', () => {
    const model = modelWith([[0, 0, 0], [1, 0, 0]])
    const built = buildRigPoseMeshes(
      model, DEFAULT_PALETTE, texture, 16, 0, 1,
      [box('outer', [0, 0, 0], [1, 0, 0]), { ...box('inner', [1, 0, 0], [1, 0, 0]), parentId: 'outer' }],
    )
    expect([...built!.boxMeshes.keys()].sort()).toEqual(['inner', 'outer'])
    expect(built!.staticMeshes.length).toBe(0)
  })
})
