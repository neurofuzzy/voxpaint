import { describe, expect, it } from 'vitest'
import type { Axis, Coord, Orientation } from '@/engine/grid/types'
import type { ConstructionPlane } from './types'
import { gridCoordFromPixel, pixelFromGridCoord } from './constructionPlane'
import { axisIndex } from './planeGeometry'
import { displayPointForGridPoint, displayViewCenter, toDisplayGridlineU, toDisplayGridlineV, toDisplayU, toDisplayV } from './planeDisplay'

const AXES: Axis[] = ['x', 'y', 'z']
const ORIENTATIONS: Orientation[] = [1, -1]

/** The two in-plane model coordinates a display cell (du, dv) maps to, in [uAxisComp, vAxisComp]
 * order. Inverts the display mirror (toDisplay is involutory) then the canonical pixel->coord map. */
function inPlaneModelCoord(plane: ConstructionPlane, du: number, dv: number): number[] {
  const u = toDisplayU(plane, du)
  const v = toDisplayV(plane, dv)
  const coord = gridCoordFromPixel(plane, u, v)
  return coord.filter((_, i) => i !== axisIndex(plane.axis))
}

describe('displayViewCenter', () => {
  it('centres on the world-origin gridline for even sizes', () => {
    for (const axis of AXES) {
      for (const orientation of ORIENTATIONS) {
        expect(displayViewCenter({ axis, orientation, offset: 0 }, 8)).toEqual({ u: 0, v: 0 })
      }
    }
  })

  it('frames an odd project on the centre pillar, dead-centre and symmetric, on every plane/orientation', () => {
    const n = 9
    for (const axis of AXES) {
      for (const orientation of ORIENTATIONS) {
        const plane: ConstructionPlane = { axis, orientation, offset: 0 }
        const centre = displayViewCenter(plane, n)

        // The window is `n` display cells wide, centred on `centre`.
        const loU = Math.floor(centre.u - n / 2)
        const loV = Math.floor(centre.v - n / 2)

        // The middle cell of the window is the pillar: it maps back to the model in-plane origin.
        const midU = loU + Math.floor(n / 2)
        const midV = loV + Math.floor(n / 2)
        expect(inPlaneModelCoord(plane, midU, midV)).toEqual([0, 0])

        // The whole visible window maps to model in-plane coords spanning exactly [-4, 4] on both
        // axes — a centred 9³ region with no padding column and nothing off-grid.
        const uComps = new Set<number>()
        const vComps = new Set<number>()
        for (let du = loU; du < loU + n; du++) {
          for (let dv = loV; dv < loV + n; dv++) {
            const [c0, c1] = inPlaneModelCoord(plane, du, dv)
            uComps.add(c0)
            vComps.add(c1)
          }
        }
        const expected = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
        expect([...uComps].sort((a, b) => a - b)).toEqual(expected)
        expect([...vComps].sort((a, b) => a - b)).toEqual(expected)
      }
    }
  })
})

describe('gridline vs cell display transforms', () => {
  const ALL_PLANES: ConstructionPlane[] = AXES.flatMap((axis) =>
    ORIENTATIONS.map((orientation) => ({ axis, orientation, offset: 0 })),
  )

  it('places a cell exactly between its own two bounding gridlines on every plane', () => {
    // The invariant the selection overlay depends on: the fill (drawn per-cell) and the outline
    // (drawn per-gridline) must describe the same square. A cell at display index n covers the
    // display span [n, n+1].
    for (const plane of ALL_PLANES) {
      for (const n of [-3, -1, 0, 1, 5]) {
        const cellU = toDisplayU(plane, n)
        expect(Math.min(toDisplayGridlineU(plane, n), toDisplayGridlineU(plane, n + 1))).toBe(cellU)
        expect(Math.max(toDisplayGridlineU(plane, n), toDisplayGridlineU(plane, n + 1))).toBe(cellU + 1)

        const cellV = toDisplayV(plane, n)
        expect(Math.min(toDisplayGridlineV(plane, n), toDisplayGridlineV(plane, n + 1))).toBe(cellV)
        expect(Math.max(toDisplayGridlineV(plane, n), toDisplayGridlineV(plane, n + 1))).toBe(cellV + 1)
      }
    }
  })

  it('is involutory, like its cell counterparts', () => {
    for (const plane of ALL_PLANES) {
      for (const n of [-4, 0, 7]) {
        expect(toDisplayGridlineU(plane, toDisplayGridlineU(plane, n))).toBe(n)
        expect(toDisplayGridlineV(plane, toDisplayGridlineV(plane, n))).toBe(n)
      }
    }
  })

  it('mirrors a gridline as -n where the cell transform uses -n - 1', () => {
    const mirroredU: ConstructionPlane = { axis: 'z', orientation: -1, offset: 0 }
    expect(toDisplayU(mirroredU, 3)).toBe(-4)
    expect(toDisplayGridlineU(mirroredU, 3)).toBe(-3)

    const mirroredV: ConstructionPlane = { axis: 'y', orientation: 1, offset: 0 }
    expect(toDisplayV(mirroredV, 3)).toBe(-4)
    expect(toDisplayGridlineV(mirroredV, 3)).toBe(-3)
  })

  it('leaves unmirrored axes identical to the cell transform', () => {
    const plane: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0 }
    expect(toDisplayGridlineU(plane, 3)).toBe(toDisplayU(plane, 3))
    expect(toDisplayGridlineV(plane, 3)).toBe(toDisplayV(plane, 3))
  })
})

describe('displayPointForGridPoint', () => {
  const ALL_PLANES: ConstructionPlane[] = AXES.flatMap((axis) =>
    ORIENTATIONS.map((orientation) => ({ axis, orientation, offset: 0 })),
  )

  it('agrees with the cell-center formula for integer cell centers on every plane', () => {
    const cells: Coord[] = [[0, 0, 0], [1, 2, 3], [-4, 5, -2]]
    for (const plane of ALL_PLANES) {
      for (const cell of cells) {
        const { u: pu, v: pv } = pixelFromGridCoord(plane, cell)
        const center: Coord = [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5]
        expect(displayPointForGridPoint(plane, center)).toEqual({
          u: toDisplayU(plane, pu) + 0.5,
          v: toDisplayV(plane, pv) + 0.5,
        })
      }
    }
  })

  it('lands a cell-boundary point exactly on the shared gridline', () => {
    // z-plane: u is unmirrored at orientation 1, mirrored at -1. Grid point x=2 is the
    // boundary between cells 1 and 2, whose centers sit at display 1.5/2.5 (ori 1) and
    // -1.5/-2.5 (ori -1).
    const fwd: ConstructionPlane = { axis: 'z', orientation: 1, offset: 0 }
    expect(displayPointForGridPoint(fwd, [2, 0.5, 0.5]).u).toBe(2)
    const mir: ConstructionPlane = { axis: 'z', orientation: -1, offset: 0 }
    expect(displayPointForGridPoint(mir, [2, 0.5, 0.5]).u).toBe(-2)
  })
})
