import { describe, expect, it } from 'vitest'
import type { ChamferCell } from '@/engine/grid/types'
import { rebaseChamferCell } from './faceBasis'

const rampXNeg: ChamferCell = { planeAxis: 'x', planeOrientation: -1, resolvedTo: { shapeKind: 'ramp', rotation: 0 } }

describe('rebaseChamferCell', () => {
  it('re-faces a ramp onto a cross-axis basis via its dual rotation', () => {
    // Dual table (see rampDual.ts): an (x,-1) rot0 ramp reproduces exactly on (z,-1) rot2.
    const cell: ChamferCell = { ...rampXNeg, resolvedTo: { ...rampXNeg.resolvedTo! } }
    expect(rebaseChamferCell(cell, 'z', -1)).toBe(true)
    expect(cell.planeAxis).toBe('z')
    expect(cell.planeOrientation).toBe(-1)
    expect(cell.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 2 })
  })

  it('reports no change for a ramp with no dual on the target basis', () => {
    // Same-axis opposite-orientation duals never exist (the full-quad side can't coincide).
    const cell: ChamferCell = { ...rampXNeg, resolvedTo: { ...rampXNeg.resolvedTo! } }
    expect(rebaseChamferCell(cell, 'x', 1)).toBe(false)
    expect(cell).toEqual(rampXNeg)
  })

  it('no-ops a ramp already on the target basis', () => {
    const cell: ChamferCell = { ...rampXNeg, resolvedTo: { ...rampXNeg.resolvedTo! } }
    // Facing to its own basis yields its own rotation — the idempotent no-op.
    expect(rebaseChamferCell(cell, 'x', -1)).toBe(false)
    expect(cell).toEqual(rampXNeg)
  })

  it('converts a wedge to its congruent ramp on the new basis', () => {
    // Dual table: a (z,+1) rot0 wedge reproduces exactly as an (x,+1) rot3 ramp.
    const cell: ChamferCell = { planeAxis: 'z', planeOrientation: 1, resolvedTo: { shapeKind: 'wedge', rotation: 0 } }
    expect(rebaseChamferCell(cell, 'x', 1)).toBe(true)
    expect(cell.resolvedTo).toEqual({ shapeKind: 'ramp', rotation: 3 })
    expect(cell.planeAxis).toBe('x')
  })

  it('flips thin slabs on their own axis, never across axes', () => {
    const flip: ChamferCell = { planeAxis: 'x', planeOrientation: -1, resolvedTo: { shapeKind: 'thin', rotation: 0 } }
    expect(rebaseChamferCell(flip, 'x', 1)).toBe(true)
    expect(flip).toEqual({ planeAxis: 'x', planeOrientation: 1, resolvedTo: { shapeKind: 'thin', rotation: 0 } })

    // Cross-axis would rotate the slab (a geometry edit) — refused.
    const turn: ChamferCell = { planeAxis: 'x', planeOrientation: -1, resolvedTo: { shapeKind: 'thin', rotation: 0 } }
    expect(rebaseChamferCell(turn, 'z', 1)).toBe(false)
    expect(turn.planeAxis).toBe('x')
  })

  it('updates the basis of unresolved cells without resolving them', () => {
    const cell: ChamferCell = { planeAxis: 'x', planeOrientation: -1, resolvedTo: null }
    expect(rebaseChamferCell(cell, 'z', 1)).toBe(true)
    expect(cell.planeAxis).toBe('z')
    expect(cell.resolvedTo).toBeNull()
  })

  it('leaves convex and concave corners untouched', () => {
    for (const shapeKind of ['convex', 'concave'] as const) {
      const cell: ChamferCell = { planeAxis: 'x', planeOrientation: -1, resolvedTo: { shapeKind, rotation: 0 } }
      expect(rebaseChamferCell(cell, 'z', 1)).toBe(false)
      expect(cell.planeAxis).toBe('x')
    }
  })
})
