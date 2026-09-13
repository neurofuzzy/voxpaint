import { describe, expect, it } from 'vitest'
import { emptyModel, encodeKey, recomputeBounds } from '@/engine/grid/GridStore'
import type { VoxelModel } from '@/engine/grid/types'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import type { PaletteSlotRef } from '@/engine/palette/types'
import { exportModelToStl } from './stlExport'

const base0: PaletteSlotRef = { kind: 'base', index: 0 }
const glass0: PaletteSlotRef = { kind: 'glass', index: 0 }

function twoVoxels(a: PaletteSlotRef, b: PaletteSlotRef): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(0, 0, 0), { paletteSlot: a })
  model.color.set(encodeKey(1, 0, 0), { paletteSlot: b }) // adjacent along +x
  return { ...model, bounds: recomputeBounds(model) }
}

/** Binary STL: 80-byte header + 4-byte uint32 triangle count + 50 bytes/triangle — this invariant
 * holds regardless of the model's actual geometry, so it's a solid structural sanity check. */
function triangleCountFromStl(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  const count = view.getUint32(80, true)
  expect(buffer.byteLength).toBe(84 + count * 50)
  return count
}

describe('exportModelToStl', () => {
  it('exports a single solid voxel as a valid binary STL (one cube, 12 triangles)', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.bounds = recomputeBounds(model)
    const stl = exportModelToStl(model, DEFAULT_PALETTE)
    expect(triangleCountFromStl(stl)).toBe(12)
  })

  it('throws on an empty model', () => {
    expect(() => exportModelToStl(emptyModel(), DEFAULT_PALETTE)).toThrow()
  })

  it('skipGlass omits glass geometry entirely', () => {
    const model = twoVoxels(base0, glass0)
    const withGlass = triangleCountFromStl(exportModelToStl(model, DEFAULT_PALETTE))
    const withoutGlass = triangleCountFromStl(exportModelToStl(model, DEFAULT_PALETTE, { skipGlass: true }))
    expect(withoutGlass).toBeLessThan(withGlass)
    expect(withoutGlass).toBe(12) // just the remaining opaque cube
  })

  it('skipGlass on an all-glass model throws instead of exporting an empty mesh', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: glass0 })
    model.bounds = recomputeBounds(model)
    expect(() => exportModelToStl(model, DEFAULT_PALETTE, { skipGlass: true })).toThrow()
  })

  it('orientForPrinting rotates the mesh without changing its triangle count', () => {
    const model = twoVoxels(base0, base0)
    const plain = triangleCountFromStl(exportModelToStl(model, DEFAULT_PALETTE))
    const oriented = triangleCountFromStl(exportModelToStl(model, DEFAULT_PALETTE, { orientForPrinting: true }))
    expect(oriented).toBe(plain)
  })

  it('scaleFactor scales the exported vertex bounds', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.bounds = recomputeBounds(model)
    const at100 = exportModelToStl(model, DEFAULT_PALETTE, { scaleFactor: 100 })
    const at200 = exportModelToStl(model, DEFAULT_PALETTE, { scaleFactor: 200 })

    function maxAbsCoord(buffer: ArrayBuffer): number {
      const view = new DataView(buffer)
      const count = view.getUint32(80, true)
      let max = 0
      for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12 // skip normal (12 bytes), read 3 vertices
        for (let v = 0; v < 3; v++) {
          for (let c = 0; c < 3; c++) {
            max = Math.max(max, Math.abs(view.getFloat32(base + v * 12 + c * 4, true)))
          }
        }
      }
      return max
    }

    expect(maxAbsCoord(at200)).toBeCloseTo(maxAbsCoord(at100) * 2, 4)
  })

  it('anchor "bottom" grounds the mesh at y=0', () => {
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: base0 })
    model.bounds = recomputeBounds(model)
    const stl = exportModelToStl(model, DEFAULT_PALETTE, { anchor: 'bottom' })
    const view = new DataView(stl)
    const count = view.getUint32(80, true)
    let minY = Infinity
    for (let t = 0; t < count; t++) {
      const base = 84 + t * 50 + 12
      for (let v = 0; v < 3; v++) minY = Math.min(minY, view.getFloat32(base + v * 12 + 4, true))
    }
    expect(minY).toBeCloseTo(0, 4)
  })
})
