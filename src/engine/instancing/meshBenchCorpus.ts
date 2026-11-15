import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import type { PaletteSlotRef } from '@/engine/palette/types'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
const base1: PaletteSlotRef = { kind: 'base', index: 1 }
const glass0: PaletteSlotRef = { kind: 'glass', index: 0 }
const metal0: PaletteSlotRef = { kind: 'metal', index: 0 }

/** N-voxel adjacent pair, same colour. */
export function domino(): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
  model.color.set(encodeKey(1, 0, 0), { paletteSlot: base0 })
  return { ...model, bounds: recomputeBounds(model) }
}

/** Solid cube of `size`^3 same-colour voxels. */
export function solidBlob(size: number): VoxelModel {
  const model = emptyModel()
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++) model.color.set(encodeKey(x, y, z), { paletteSlot: base0 })
  return { ...model, bounds: recomputeBounds(model) }
}

/** Checkerboard of two colours in a `size`^3 volume (worst case: many small groups, disconnected). */
export function checkerboard(size: number): VoxelModel {
  const model = emptyModel()
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++)
        model.color.set(encodeKey(x, y, z), { paletteSlot: (x + y + z) % 2 === 0 ? base0 : base1 })
  return { ...model, bounds: recomputeBounds(model) }
}

/** Flat slab of `size` x `size` voxels, one layer — stresses the coplanar merge (one big plane). */
export function slab(size: number): VoxelModel {
  const model = emptyModel()
  for (let x = 0; x < size; x++)
    for (let z = 0; z < size; z++) model.color.set(encodeKey(x, 0, z), { paletteSlot: base0 })
  return { ...model, bounds: recomputeBounds(model) }
}

/** Alternating ramp/cube field: every other cell is a resolved ramp (stresses chamfer path). */
export function chamferField(size: number): VoxelModel {
  const model = emptyModel()
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      model.color.set(encodeKey(x, 0, z), { paletteSlot: base0 })
      if ((x + z) % 2 === 0) {
        model.chamfer.set(encodeKey(x, 0, z), {
          planeAxis: 'z',
          planeOrientation: 1,
          resolvedTo: { shapeKind: 'ramp', rotation: ((x + z) % 4) as 0 | 1 | 2 | 3 },
        })
      }
    }
  }
  return { ...model, bounds: recomputeBounds(model) }
}

/** Glass wall flush against a matte wall — stresses the glass occlusion + cross-group cull. */
export function glassWall(size: number): VoxelModel {
  const model = emptyModel()
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      model.color.set(encodeKey(x, 0, z), { paletteSlot: base0 })
      model.color.set(encodeKey(x, 1, z), { paletteSlot: glass0 })
    }
  }
  return { ...model, bounds: recomputeBounds(model) }
}

/** Mixed-material row: matte / metal / glass / emissive cycling — stresses cross-group cull. */
export function mixedRow(): VoxelModel {
  const model = emptyModel()
  const slots: PaletteSlotRef[] = [base0, metal0, glass0, { kind: 'emissive', index: 0 }]
  slots.forEach((paletteSlot, i) => model.color.set(encodeKey(i, 0, 0), { paletteSlot }))
  return { ...model, bounds: recomputeBounds(model) }
}

export const CORPUS: { name: string; voxels: number; build: () => VoxelModel }[] = [
  { name: 'domino(2)', voxels: 2, build: domino },
  { name: 'slab-8x8(64)', voxels: 64, build: () => slab(8) },
  { name: 'solid-4^3(64)', voxels: 64, build: () => solidBlob(4) },
  { name: 'solid-6^3(216)', voxels: 216, build: () => solidBlob(6) },
  { name: 'checker-6^3(~216)', voxels: 216, build: () => checkerboard(6) },
  { name: 'chamfer-8x8(64)', voxels: 64, build: () => chamferField(8) },
  { name: 'glasswall-8x8(128)', voxels: 128, build: () => glassWall(8) },
  { name: 'mixed-row(4)', voxels: 4, build: mixedRow },
]
