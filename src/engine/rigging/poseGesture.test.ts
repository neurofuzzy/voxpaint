import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Coord } from '@/engine/grid/types'
import type { RigBox } from './types'
import { angleAroundAxis, gizmoRadiusForBox, intersectAxisPlane, nearestRingHit } from './pose'

/**
 * End-to-end gesture simulation: a real perspective camera, the same world→pixel
 * projection the viewport uses, a ring hit exactly as the down handler computes it, then a
 * 100px drag through the same grab/move math. If the resulting delta is ~zero, the pipeline
 * itself is broken (not the DOM wiring).
 */
describe('pose gesture pipeline', () => {
  const WIDTH = 800
  const HEIGHT = 800
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500)
  camera.position.set(12, 9, 12)
  camera.lookAt(1.5, 1.5, 1.5)
  camera.updateMatrixWorld()

  const project = (p: Coord): [number, number] | null => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera)
    if (v.z > 1 || v.z < -1) return null
    return [(v.x + 1) / 2 * WIDTH, (1 - v.y) / 2 * HEIGHT]
  }

  function gridRay(sx: number, sy: number): { origin: [number, number, number]; dir: [number, number, number] } {
    const ndc = new THREE.Vector2((sx / WIDTH) * 2 - 1, -((sy / HEIGHT) * 2 - 1))
    const rc = new THREE.Raycaster()
    rc.setFromCamera(ndc, camera)
    const o = rc.ray.origin
    const d = rc.ray.direction.clone().normalize()
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] }
  }

  const box: RigBox = { id: 'arm', name: 'arm', min: [0, 0, 0], max: [2, 2, 2], parentId: null, pivot: null }

  it('down-hits a ring and a 100px drag produces a large delta', () => {
    const radius = gizmoRadiusForBox(box)
    expect(radius).toBeCloseTo(2.7, 10)
    // Screen point on the z-ring at θ=0: grid (1.5 + r, 1.5, 1.5).
    const startPx = project([1.5 + radius, 1.5, 1.5])!
    expect(startPx).not.toBeNull()

    // DOWN: nearest ring + grab angle, exactly like the handler.
    const downRay = gridRay(startPx[0], startPx[1])
    const axis = nearestRingHit([], new Map(), box, downRay.origin, downRay.dir, project, startPx[0], startPx[1], 14)
    expect(axis).toBe('z')
    const pw: Coord = [1.5, 1.5, 1.5]
    const grabPt = intersectAxisPlane(downRay.origin, downRay.dir, pw, 'z')!
    const grabAngle = angleAroundAxis(grabPt, pw, 'z')

    // MOVE: 100px right, same math as the handler.
    const moveRay = gridRay(startPx[0] + 100, startPx[1])
    const movePt = intersectAxisPlane(moveRay.origin, moveRay.dir, pw, 'z')!
    const raw = angleAroundAxis(movePt, pw, 'z') - grabAngle
    const TAU = Math.PI * 2
    const delta = ((raw + Math.PI) % TAU + TAU) % TAU - Math.PI
    // A 100px drag along the ring must swing a clearly visible angle — not ~zero.
    // (Exact degrees depend on view geometry; the point is the pipeline produces motion.)
    expect(Math.abs(delta)).toBeGreaterThan(0.1)
  })
})
