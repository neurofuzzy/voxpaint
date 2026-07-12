import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Axis, Coord, Orientation } from '@/engine/grid/types'
import { mirrorVGeometry, rampGeometry } from '@/engine/chamfer/chamferGeometry'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { ALL_AXES, outwardNormal } from '@/engine/plane/planeGeometry'
import { chamferBasisIsReflected, chamferInstanceMatrix } from './basis'

const ORIENTATIONS: Orientation[] = [1, -1]
const ROTATIONS = [0, 1, 2, 3] as const

/** Determinant of the instance matrix's linear (rotation/scale) part. */
function linearDeterminant(m: THREE.Matrix4): number {
  return new THREE.Matrix3().setFromMatrix4(m).determinant()
}

function transformedVertexSet(geometry: THREE.BufferGeometry, m: THREE.Matrix4): Set<string> {
  const pos = geometry.getAttribute('position')
  const out = new Set<string>()
  const p = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m)
    out.add([p.x, p.y, p.z].map((n) => Math.round(n * 1e5) / 1e5).join(','))
  }
  return out
}

/** The pre-fix reflected placement: raw makeBasis(worldU, worldV, outward)·Rz(θ), centered on the cell. */
function rawReflectedMatrix(coord: Coord, axis: Axis, orientation: Orientation, rotation: number): THREE.Matrix4 {
  const { uDir, vDir } = planeLogicalBasis(axis)
  const w = outwardNormal(axis, orientation)
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...uDir), new THREE.Vector3(...vDir), new THREE.Vector3(...w))
  basis.setPosition(coord[0] + 0.5, coord[1] + 0.5, coord[2] + 0.5)
  return basis.multiply(new THREE.Matrix4().makeRotationZ((rotation * Math.PI) / 2))
}

describe('chamferInstanceMatrix — always a proper rotation (regression: reflected planes shaded dark)', () => {
  // A negative-determinant (reflection) instance matrix flips screen winding and inverts front/back,
  // so those chamfers lit as if from behind. Every produced matrix must be a proper rotation (det=+1),
  // regardless of plane / orientation / baked rotation — that's what the mirrored geometry pools buy.
  it.each(ALL_AXES)('axis %s: det=+1 for every orientation and rotation', (axis: Axis) => {
    for (const orientation of ORIENTATIONS) {
      for (const rotation of ROTATIONS) {
        const m = chamferInstanceMatrix([2, -3, 4], axis, orientation, rotation)
        expect(linearDeterminant(m), `${axis} o=${orientation} r=${rotation}`).toBeCloseTo(1, 6)
      }
    }
  })

  it('exactly the +Z, +X, -Y planes report a reflected basis', () => {
    const reflected = new Set<string>()
    for (const axis of ALL_AXES) {
      for (const orientation of ORIENTATIONS) {
        if (chamferBasisIsReflected(axis, orientation)) reflected.add(`${axis},${orientation}`)
      }
    }
    expect(reflected).toEqual(new Set(['z,1', 'x,1', 'y,-1']))
  })
})

describe('chamferInstanceMatrix — the reflection fix preserves placement', () => {
  // Mirrored geometry under the proper matrix must land in the *same world position* as the naive
  // reflected basis applied to the un-mirrored geometry — same shape, same place, just det=+1.
  it.each(ROTATIONS)('mirrored ramp under the proper matrix == raw reflected placement (rotation %i)', (rotation) => {
    const axis: Axis = 'z' // +Z is a reflected plane
    const orientation: Orientation = 1
    const coord: Coord = [1, -2, 3]

    const proper = transformedVertexSet(mirrorVGeometry(rampGeometry(0)), chamferInstanceMatrix(coord, axis, orientation, rotation))
    const raw = transformedVertexSet(rampGeometry(0), rawReflectedMatrix(coord, axis, orientation, rotation))
    expect(proper).toEqual(raw)
  })

  it('non-reflected planes are untouched: proper matrix == raw basis placement (y, +1)', () => {
    const coord: Coord = [1, -2, 3]
    const proper = transformedVertexSet(rampGeometry(0), chamferInstanceMatrix(coord, 'y', 1, 2))
    const raw = transformedVertexSet(rampGeometry(0), rawReflectedMatrix(coord, 'y', 1, 2))
    expect(proper).toEqual(raw)
  })
})
