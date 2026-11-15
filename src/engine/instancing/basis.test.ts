import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Axis, Coord, Orientation } from '@/engine/grid/types'
import { mirrorVGeometry, rampGeometry } from '@/engine/chamfer/chamferGeometry'
import { planeLogicalBasis } from '@/engine/plane/constructionPlane'
import { ALL_AXES, outwardNormal } from '@/engine/plane/planeGeometry'
import { chamferBasisIsReflected, chamferInstanceMatrix, scaledChamferInstanceMatrix } from './basis'

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

describe('scaledChamferInstanceMatrix — the scaled prefab fills exactly its subcell box', () => {
  // Regression: the scale used to compose before the spin (T·Basis·Rz·S), rotating the squash
  // axes with the shape — odd rotations in anisotropic boxes came out narrow on one world
  // axis and overflowing their box on the other (a mirrored half-height stern wedge rendered
  // 0.5 wide and a full voxel tall). The matrix maps the unit prefab, so its unit-cube image
  // must be the box itself for every axis, orientation, rotation, and split shape.
  function unitCubeImage(axis: Axis, orientation: Orientation, rotation: (typeof ROTATIONS)[number], origin: Coord, size: [number, number, number]): THREE.Box3 {
    const m = scaledChamferInstanceMatrix(origin, size, axis, orientation, rotation, new THREE.Matrix4())
    const box = new THREE.Box3()
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) {
          box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(m))
        }
      }
    }
    return box
  }

  function expectFillsBox(axis: Axis, orientation: Orientation, rotation: (typeof ROTATIONS)[number], origin: Coord, size: [number, number, number]): void {
    const box = unitCubeImage(axis, orientation, rotation, origin, size)
    const tag = `${axis} o=${orientation} r=${rotation} origin=${origin} size=${size}`
    for (const a of [0, 1, 2] as const) {
      expect(box.min.getComponent(a), `${tag} min[${a}]`).toBeCloseTo(origin[a], 9)
      expect(box.max.getComponent(a), `${tag} max[${a}]`).toBeCloseTo(origin[a] + size[a], 9)
    }
  }

  it('fills a y-split half box at every rotation (mirrored barge-stern wedge)', () => {
    // Stern cell from the barge report: y-split low half holding a z-faced wedge; the mirror
    // lands it on odd rotations, which was exactly the broken case.
    for (const rotation of ROTATIONS) {
      expectFillsBox('z', 1, rotation, [3, -8, 0], [1, 0.5, 1])
    }
  })

  it('fills every anisotropic split shape on every axis, orientation, and rotation', () => {
    const sizes: Array<[number, number, number]> = [
      [0.5, 1, 1],
      [1, 0.5, 1],
      [1, 1, 0.5],
      [0.5, 0.5, 1],
      [0.5, 0.5, 0.5],
      [1, 1, 1],
    ]
    for (const axis of ALL_AXES) {
      for (const orientation of ORIENTATIONS) {
        for (const rotation of ROTATIONS) {
          for (const size of sizes) {
            expectFillsBox(axis, orientation, rotation, [-5, -8, -1], size)
          }
        }
      }
    }
  })

  it('keeps a positive determinant (proper rotation times positive scale)', () => {
    for (const axis of ALL_AXES) {
      for (const orientation of ORIENTATIONS) {
        for (const rotation of ROTATIONS) {
          const m = scaledChamferInstanceMatrix([3, -8, 0], [1, 0.5, 1], axis, orientation, rotation)
          expect(linearDeterminant(m), `${axis} o=${orientation} r=${rotation}`).toBeCloseTo(0.5, 9)
        }
      }
    }
  })
})
