import { describe, expect, it } from 'vitest'
import { decodeKey, emptyModel, encodeKey } from '@/engine/grid/GridStore'
import type { Axis, ChamferShapeKind, Coord, Orientation, Rotation, VoxelModel } from '@/engine/grid/types'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { outwardNormal } from '@/engine/plane/planeGeometry'
import { rescaleCoord, rescaleTargetExtent, rescaleVoxelModel } from './rescale'

const SLOT = { kind: 'base', index: 0 } as const

/** One-voxel model at `coord`, optionally with a chamfer entry. */
function singleVoxel(
  coord: Coord,
  chamfer?: { axis: Axis; orientation: Orientation; kind: ChamferShapeKind; rotation: Rotation } | null,
): VoxelModel {
  const model = emptyModel()
  model.color.set(encodeKey(...coord), { paletteSlot: { ...SLOT } })
  if (chamfer === null) {
    // Unresolved entry: renders as a cube, resolves later.
    model.chamfer.set(encodeKey(...coord), { planeAxis: 'z', planeOrientation: 1, resolvedTo: null })
  } else if (chamfer) {
    model.chamfer.set(encodeKey(...coord), {
      planeAxis: chamfer.axis,
      planeOrientation: chamfer.orientation,
      resolvedTo: { shapeKind: chamfer.kind, rotation: chamfer.rotation },
    })
  }
  return model
}

/** World coordinate of logical child (du, dv, dw) of `base` on the given basis — mirrors the
 * implementation's placement (negative basis components flip the sub-index). */
function childAt(base: Coord, axis: Axis, orientation: Orientation, du: number, dv: number, dw: number): Coord {
  const { uDir: U, vDir: V } = planeLogicalBasis(axis)
  const W = outwardNormal(axis, orientation)
  const ds = [du, dv, dw]
  const dirs = [U, V, W]
  const out: Coord = [0, 0, 0]
  for (let j = 0; j < 3; j++) {
    const k = dirs.findIndex((D) => D[j] !== 0)
    out[j] = 2 * base[j] + (dirs[k][j] > 0 ? ds[k] : 1 - ds[k])
  }
  return out
}

function outcomeOf(model: VoxelModel, coord: Coord): string {
  const key = encodeKey(...coord)
  if (!model.color.has(key)) return 'empty'
  const resolved = model.chamfer.get(key)?.resolvedTo
  if (!resolved) return 'cube'
  return `${resolved.shapeKind}:${resolved.rotation}`
}

describe('rescaleTargetExtent', () => {
  it('doubles even extents and rounds odd up first', () => {
    expect(rescaleTargetExtent(2)).toBe(4)
    expect(rescaleTargetExtent(8)).toBe(16)
    expect(rescaleTargetExtent(16)).toBe(32)
    expect(rescaleTargetExtent(24)).toBe(48)
    // Odd 15 works on the even 16 grid, so it grows to 32 (not a clipping 30).
    expect(rescaleTargetExtent(15)).toBe(32)
  })
})

describe('rescaleCoord', () => {
  it('doubles about the origin', () => {
    expect(rescaleCoord(0)).toEqual([0, 1])
    expect(rescaleCoord(5)).toEqual([10, 11])
    expect(rescaleCoord(-1)).toEqual([-2, -1])
  })
})

describe('rescaleVoxelModel', () => {
  it('maps an empty model to an empty model', () => {
    const next = rescaleVoxelModel(emptyModel())
    expect(next.color.size).toBe(0)
    expect(next.chamfer.size).toBe(0)
    expect(next.bounds).toBeNull()
  })

  it('expands a plain cube to 8 cubes with recomputed bounds', () => {
    const next = rescaleVoxelModel(singleVoxel([1, 2, 3]))
    expect(next.color.size).toBe(8)
    expect(next.chamfer.size).toBe(0)
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dz = 0; dz < 2; dz++) {
          const cell = next.color.get(encodeKey(2 + dx, 4 + dy, 6 + dz))
          expect(cell?.paletteSlot).toEqual(SLOT)
        }
      }
    }
    expect(next.bounds).toEqual({ min: [2, 4, 6], max: [3, 5, 7] })
  })

  it('carries unresolved chamfer cells verbatim (basis preserved, still null)', () => {
    const next = rescaleVoxelModel(singleVoxel([0, 0, 0], null))
    expect(next.color.size).toBe(8)
    expect(next.chamfer.size).toBe(8)
    for (const key of next.chamfer.keys()) {
      expect(next.chamfer.get(key)).toEqual({ planeAxis: 'z', planeOrientation: 1, resolvedTo: null })
    }
  })

  it('decomposes a z-plane ramp-0 into 2 cubes + 4 same-rotation ramps', () => {
    // Hand-derived in the z logical frame (U=+x, V=−y, W=+z): per v-layer the (du,dw) pattern is
    // (0,0)=cube, (0,1)=ramp, (1,0)=ramp, (1,1)=empty — the 2x staircase of an east-opening ramp.
    // World placement flips v (V runs toward −y), so dv=0 lands on y=1 and dv=1 on y=0.
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'ramp', rotation: 0 }))
    expect(next.color.size).toBe(6)
    const expected = new Map<string, string>([
      [encodeKey(0, 1, 0), 'cube'],
      [encodeKey(0, 0, 0), 'cube'],
      [encodeKey(0, 1, 1), 'ramp:0'],
      [encodeKey(0, 0, 1), 'ramp:0'],
      [encodeKey(1, 1, 0), 'ramp:0'],
      [encodeKey(1, 0, 0), 'ramp:0'],
    ])
    expect(new Set(next.color.keys())).toEqual(new Set(expected.keys()))
    for (const [key, want] of expected) {
      expect(outcomeOf(next, decodeKey(key))).toBe(want)
      const cell = next.chamfer.get(key)
      if (want !== 'cube') {
        expect(cell?.planeAxis).toBe('z')
        expect(cell?.planeOrientation).toBe(1)
      }
    }
  })

  it('decomposes a wedge-0 into 2 cubes + 4 same-rotation wedges', () => {
    // Wedge-0 cuts the NE corner ({u ≤ v}): per w-layer (0,1)=cube, (0,0)+(1,1)=wedge, (1,0)=empty.
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'wedge', rotation: 0 }))
    expect(next.color.size).toBe(6)
    for (const dw of [0, 1]) {
      expect(outcomeOf(next, childAt(base, 'z', 1, 0, 1, dw))).toBe('cube')
      expect(outcomeOf(next, childAt(base, 'z', 1, 0, 0, dw))).toBe('wedge:0')
      expect(outcomeOf(next, childAt(base, 'z', 1, 1, 1, dw))).toBe('wedge:0')
      expect(outcomeOf(next, childAt(base, 'z', 1, 1, 0, dw))).toBe('empty')
    }
  })

  it('decomposes a convex-0 corner into cubes, corners and ramps', () => {
    // Hand-derived in the z logical frame for the SW-high pyramid ({w ≤ v} ∩ {u+w ≤ 1}): the
    // bottom layer keeps full cubes where the pyramid covers the whole child and ramps where a
    // hip plane cuts through; the apex child keeps a smaller convex corner; far top children
    // are empty edges. Volumes: 1 + 2×(1/3) + 2×(1/2) = 8/3.
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'convex', rotation: 0 }))
    expect(next.color.size).toBe(5)
    const expected: Array<[number, number, number, string]> = [
      [0, 0, 0, 'ramp:3'],
      [1, 0, 0, 'convex:0'],
      [0, 1, 0, 'cube'],
      [1, 1, 0, 'ramp:0'],
      [0, 1, 1, 'convex:0'],
    ]
    for (const [du, dv, dw, want] of expected) {
      expect(outcomeOf(next, childAt(base, 'z', 1, du, dv, dw))).toBe(want)
    }
  })

  it('decomposes a concave-0 notch into cubes, notches and ramps', () => {
    // Hand-derived in the z logical frame for the NE notch ({w ≤ v} ∪ {u+w ≤ 1}): notch walls
    // become smaller concave corners and ramps in the cut children; the far-corner child is a
    // zero-volume edge and stays empty. Volumes: 3 + 2×(2/3) + 2×(1/2) = 16/3.
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'concave', rotation: 0 }))
    expect(next.color.size).toBe(7)
    const expected: Array<[number, number, number, string]> = [
      [0, 0, 0, 'cube'],
      [0, 1, 0, 'cube'],
      [1, 1, 0, 'cube'],
      [0, 1, 1, 'concave:0'],
      [1, 0, 0, 'concave:0'],
      [0, 0, 1, 'ramp:0'],
      [1, 1, 1, 'ramp:3'],
    ]
    for (const [du, dv, dw, want] of expected) {
      expect(outcomeOf(next, childAt(base, 'z', 1, du, dv, dw))).toBe(want)
    }
    expect(outcomeOf(next, childAt(base, 'z', 1, 1, 0, 1))).toBe('empty')
  })

  it('turns a rotated ramp with its slope (ramp-1 opens south)', () => {    // Knife edge moves east→south: cubes gather at dv=0,dw=0, empties at dv=1,dw=1, all rotation 1.
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'ramp', rotation: 1 }))
    expect(next.color.size).toBe(6)
    let ramps = 0
    for (let du = 0; du < 2; du++) {
      for (let dv = 0; dv < 2; dv++) {
        for (let dw = 0; dw < 2; dw++) {
          const outcome = outcomeOf(next, childAt(base, 'z', 1, du, dv, dw))
          if (dv === 0 && dw === 0) expect(outcome).toBe('cube')
          else if (dv === 1 && dw === 1) expect(outcome).toBe('empty')
          else {
            expect(outcome).toBe('ramp:1')
            ramps++
          }
        }
      }
    }
    expect(ramps).toBe(4)
  })

  it('expands a thin slab to 8 back-to-back halves, +1 below and −1 above', () => {
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'thin', rotation: 0 }))
    expect(next.color.size).toBe(8)
    expect(next.chamfer.size).toBe(8)
    for (let du = 0; du < 2; du++) {
      for (let dv = 0; dv < 2; dv++) {
        for (let dw = 0; dw < 2; dw++) {
          const coord = childAt(base, 'z', 1, du, dv, dw)
          const cell = next.chamfer.get(encodeKey(...coord))
          expect(cell?.resolvedTo).toEqual({ shapeKind: 'half', rotation: 0 })
          expect(cell?.planeAxis).toBe('z')
          // Lower layer's slab sits in its top half (+1), upper layer's in its bottom half (−1).
          expect(cell?.planeOrientation).toBe(dw === 0 ? 1 : -1)
        }
      }
    }
  })

  it('snaps a half slab to 4 full cubes in its own layer', () => {
    const base: Coord = [0, 0, 0]
    const upper = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'half', rotation: 0 }))
    expect(upper.color.size).toBe(4)
    expect(upper.chamfer.size).toBe(0)
    for (let du = 0; du < 2; du++) {
      for (let dv = 0; dv < 2; dv++) {
        expect(upper.color.has(encodeKey(...childAt(base, 'z', 1, du, dv, 1)))).toBe(true)
        expect(upper.color.has(encodeKey(...childAt(base, 'z', 1, du, dv, 0)))).toBe(false)
      }
    }
    const lower = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: -1, kind: 'half', rotation: 0 }))
    expect(lower.color.size).toBe(4)
    for (let du = 0; du < 2; du++) {
      for (let dv = 0; dv < 2; dv++) {
        expect(lower.color.has(encodeKey(...childAt(base, 'z', -1, du, dv, 0)))).toBe(true)
        expect(lower.color.has(encodeKey(...childAt(base, 'z', -1, du, dv, 1)))).toBe(false)
      }
    }
  })

  it('expands a post to 8 quarter-columns, one inner corner per child', () => {
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'post', rotation: 0 }))
    expect(next.color.size).toBe(8)
    expect(next.chamfer.size).toBe(8)
    // Child (du,dv) spans u∈[du,du+1] about center 1: its inner corner is SE/SW/NE/NW.
    const expected: Record<string, number> = { '0,0': 1, '1,0': 2, '0,1': 0, '1,1': 3 }
    for (let du = 0; du < 2; du++) {
      for (let dv = 0; dv < 2; dv++) {
        for (let dw = 0; dw < 2; dw++) {
          const coord = childAt(base, 'z', 1, du, dv, dw)
          const cell = next.chamfer.get(encodeKey(...coord))
          expect(cell?.resolvedTo).toEqual({ shapeKind: 'quarter', rotation: expected[`${du},${dv}`] })
          expect(cell?.planeAxis).toBe('z')
          expect(cell?.planeOrientation).toBe(1)
        }
      }
    }
  })

  it('tiles a flat wedge onto the doubled diagonal, same rotation', () => {
    const base: Coord = [0, 0, 0]
    // Even rotations ride NW-SE through (0,0)+(1,1); odd ride NE-SW through (1,0)+(0,1).
    for (const rotation of [0, 1, 2, 3] as const) {
      const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'flatwedge', rotation }))
      expect(next.color.size, `r=${rotation}`).toBe(4)
      expect(next.chamfer.size, `r=${rotation}`).toBe(4)
      for (let du = 0; du < 2; du++) {
        for (let dv = 0; dv < 2; dv++) {
          for (let dw = 0; dw < 2; dw++) {
            const onDiag = rotation % 2 === 0 ? du === dv : du !== dv
            const key = encodeKey(...childAt(base, 'z', 1, du, dv, dw))
            expect(next.color.has(key), `r=${rotation} ${du},${dv},${dw}`).toBe(onDiag)
            if (onDiag) {
              const cell = next.chamfer.get(key)
              expect(cell?.resolvedTo).toEqual({ shapeKind: 'flatwedge', rotation })
              expect(cell?.planeAxis).toBe('z')
              expect(cell?.planeOrientation).toBe(1)
            }
          }
        }
      }
    }
  })

  it('shifts a flat into the +normal-side layer (no exact fit exists)', () => {
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'flat', rotation: 0 }))
    // The doubled centre plane is the dw boundary: 4 flats tiling the dw=1 layer, verbatim basis.
    expect(next.color.size).toBe(4)
    expect(next.chamfer.size).toBe(4)
    for (let du = 0; du < 2; du++) {
      for (let dv = 0; dv < 2; dv++) {
        for (let dw = 0; dw < 2; dw++) {
          const key = encodeKey(...childAt(base, 'z', 1, du, dv, dw))
          expect(next.color.has(key), `${du},${dv},${dw}`).toBe(dw === 1)
          if (dw === 1) {
            expect(next.chamfer.get(key)?.resolvedTo).toEqual({ shapeKind: 'flat', rotation: 0 })
          }
        }
      }
    }
  })

  it('snaps a quarter column to 2 full cubes in its quadrant', () => {
    const base: Coord = [0, 0, 0]
    // Rotation 0 = NE quadrant (du=1, dv=0); rotation 2 = SW (du=0, dv=1).
    for (const [rotation, qu, qv] of [[0, 1, 0], [1, 1, 1], [2, 0, 1], [3, 0, 0]] as const) {
      const next = rescaleVoxelModel(singleVoxel(base, { axis: 'z', orientation: 1, kind: 'quarter', rotation }))
      expect(next.color.size, `r=${rotation}`).toBe(2)
      expect(next.chamfer.size, `r=${rotation}`).toBe(0)
      for (let du = 0; du < 2; du++) {
        for (let dv = 0; dv < 2; dv++) {
          for (let dw = 0; dw < 2; dw++) {
            expect(next.color.has(encodeKey(...childAt(base, 'z', 1, du, dv, dw))), `r=${rotation} ${du},${dv},${dw}`).toBe(
              du === qu && dv === qv,
            )
          }
        }
      }
    }
  })

  it('never lets neighboring voxels collide (negative-basis placement)', () => {
    // Regression test: the z-plane v axis runs toward −y, and a naive du·V placement mapped two
    // face-adjacent voxels onto 4 shared children. Children must tile exactly [2c, 2c+1].
    const model = emptyModel()
    model.color.set(encodeKey(0, 0, 0), { paletteSlot: { ...SLOT } })
    model.color.set(encodeKey(0, 1, 0), { paletteSlot: { ...SLOT } })
    model.chamfer.set(encodeKey(0, 1, 0), {
      planeAxis: 'z',
      planeOrientation: 1,
      resolvedTo: { shapeKind: 'thin', rotation: 0 },
    })
    const next = rescaleVoxelModel(model)
    expect(next.color.size).toBe(8 + 8)
    expect(next.bounds).toEqual({ min: [0, 0, 0], max: [1, 3, 1] })
  })

  it('keeps cross-axis bases verbatim (x-authored ramp)', () => {
    const base: Coord = [0, 0, 0]
    const next = rescaleVoxelModel(singleVoxel(base, { axis: 'x', orientation: 1, kind: 'ramp', rotation: 0 }))
    expect(next.color.size).toBe(6)
    for (const cell of next.chamfer.values()) {
      expect(cell.planeAxis).toBe('x')
      expect(cell.planeOrientation).toBe(1)
      expect(cell.resolvedTo?.shapeKind).toBe('ramp')
    }
  })

  it('conserves solid volume exactly for every kind and rotation', () => {
    // The sampler is exact (parent planes restrict to canonical planes on every child), so each
    // parent's 8x volume must equal its children's summed volumes — zero-volume edge/point
    // children are empty on both sides of the equation. Child cells are the same world size as
    // the parent's, so volumes compare directly.
    const volume: Record<string, number> = {
      cube: 1, ramp: 1 / 2, wedge: 1 / 2, convex: 1 / 3, concave: 2 / 3, thin: 1 / 2, half: 1 / 2,
      post: 1 / 4, quarter: 1 / 4, flat: 0, flatwedge: 0,
    }
    const kinds: ChamferShapeKind[] = ['ramp', 'wedge', 'convex', 'concave', 'thin', 'half', 'post', 'quarter', 'flat', 'flatwedge']
    for (const kind of kinds) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const next = rescaleVoxelModel(singleVoxel([0, 0, 0], { axis: 'z', orientation: 1, kind, rotation }))
        let sum = 0
        for (const key of next.color.keys()) {
          const resolved = next.chamfer.get(key)?.resolvedTo
          sum += resolved ? volume[resolved.shapeKind] : 1
        }
        expect(sum, `${kind} r=${rotation}`).toBeCloseTo(8 * volume[kind], 10)
      }
    }
  })
})
