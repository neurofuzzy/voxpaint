import * as THREE from 'three'

/**
 * Local prefab space shared by all chamfer shapes: the unit cell **centered on the origin**,
 * `[-0.5, 0.5]^3`. Axes: `x = u`, `y = v` (the plane's in-plane axes, with `u+` = east and
 * `v+` = south to match constructionPlane.ts's logical basis), `z` = outward extent (`z = +0.5`
 * is the flush face against the construction plane, `z = -0.5` is the inward base).
 *
 * Centering the model on the voxel's own 3D center (per `etc/chamfer-tests.md`) means the
 * per-instance baked rotation is a plain rotation about the origin — no translate-to-center dance —
 * and the mesh lands exactly on its cell with no half-unit offset. Per-instance placement (world
 * axis mapping + orientation flip + baked rotation) is applied afterward by the instancing manager,
 * see engine/instancing/basis.ts.
 *
 * Winding: every triangle below is listed counter-clockwise **as seen from outside the solid**, so
 * `computeVertexNormals()` yields outward-facing normals. (The chamfer instance basis is a reflection
 * on the x/z planes, which flips triangle orientation in screen space — the material renders
 * `DoubleSide` so faces stay visible regardless; see InstancingManager.ts.)
 */

const H = 0.5

// Corner order: NE=0, SE=1, SW=2, NW=3 (clockwise from north-east) — shared with chamferResolver.
const CORNER_UV: Record<number, [number, number]> = {
  0: [H, -H], // NE
  1: [H, H], // SE
  2: [-H, H], // SW
  3: [-H, -H], // NW
}

/** Base (inward, z=-0.5) vertex at corner `i`. */
function b(i: number): [number, number, number] {
  const [u, v] = CORNER_UV[i]
  return [u, v, -H]
}
/** Top (outward / flush face, z=+0.5) vertex at corner `i`. */
function t(i: number): [number, number, number] {
  const [u, v] = CORNER_UV[i]
  return [u, v, H]
}

function buildGeometry(triangles: number[][][], rotation: 0 | 1 | 2 | 3): THREE.BufferGeometry {
  const positions: number[] = []
  for (const tri of triangles) {
    for (const v of tri) positions.push(v[0], v[1], v[2])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  // Baked rotation is a plain rotation about the (centered) origin — the model's own up axis.
  if (rotation) geometry.rotateZ((rotation * Math.PI) / 2)
  geometry.computeVertexNormals()
  return geometry
}

/** Model A — full cube: 6 sides, 12 triangles. Centered on the origin like the chamfer prefabs. */
export function unitCubeGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1)
}

/**
 * Mirror a chamfer geometry across the v axis (negate local y) with winding reversed so faces stay
 * outward-wound. Paired with the proper-rotation matrix chamferInstanceMatrix produces for reflected
 * planes, this renders the identical shape in the identical place but with det=+1 (so lighting is
 * correct) — see engine/instancing/basis.ts's chamferBasisIsReflected.
 */
export function mirrorVGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  g.scale(1, -1, 1) // mirror across v; this also flips triangle winding
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  for (let i = 0; i < pos.count; i += 3) {
    // Swap the 2nd and 3rd vertex of each triangle to restore counter-clockwise (outward) winding.
    for (let k = 0; k < 3; k++) {
      const a = (i + 1) * 3 + k
      const c = (i + 2) * 3 + k
      const tmp = arr[a]
      arr[a] = arr[c]
      arr[c] = tmp
    }
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  return g
}

/**
 * Model B — simple ramp (triangular prism): 5 sides, 8 triangles. Full height along the west edge
 * (corners SW/NW), tapering to a knife edge along the east edge (corners NE/SE) — i.e. the canonical
 * (rotation-0) ramp **opens toward east**, matching chamferResolver.classify()'s convention. The two
 * sloped sides (north and south walls) are single triangles; the west back wall is a full-height quad.
 */
export function rampGeometry(rotation: 0 | 1 | 2 | 3 = 0): THREE.BufferGeometry {
  return buildGeometry(
    [
      // bottom (full footprint, z=-0.5)
      [b(0), b(3), b(2)],
      [b(0), b(2), b(1)],
      // sloped roof, from the east knife edge (AB) up to the west top edge (GH)
      [b(0), b(1), t(2)],
      [b(0), t(2), t(3)],
      // west back wall (full-height quad)
      [b(3), t(3), t(2)],
      [b(3), t(2), b(2)],
      // north + south sloped-side triangles
      [b(0), t(3), b(3)], // north
      [b(1), b(2), t(2)], // south
    ],
    rotation,
  )
}

/**
 * Model C — convex corner ramp: 4 sides, 6 triangles. Full height only at the south-west corner
 * (its single top vertex is above SW), sloping down to the base at every other corner. Canonical
 * (rotation-0) full-height corner is SW; the resolver's `rotation` is the *open* (cut) corner index,
 * NE=0. The roof is a hip fan of two triangles from the SW top vertex over the three base corners;
 * each roof triangle shares 2 of its 3 vertices with the bottom.
 */
export function convexCornerGeometry(rotation: 0 | 1 | 2 | 3 = 0): THREE.BufferGeometry {
  return buildGeometry(
    [
      // bottom (full footprint, z=-0.5)
      [b(0), b(3), b(2)],
      [b(0), b(2), b(1)],
      // two full-height walls meeting at the SW corner, rising to its single top vertex
      [b(3), t(2), b(2)], // west wall triangle
      [b(2), t(2), b(1)], // south wall triangle
      // hip roof: two sloped facets fanning from the SW top vertex over the NW/NE/SE base corners
      [t(2), b(3), b(0)], // G, D, A
      [t(2), b(0), b(1)], // G, A, B
    ],
    rotation,
  )
}

/**
 * Model D — concave corner ramp: 6 sides, 10 triangles. Full height along all four edges except the
 * single notched corner (north-east), which drops to the base — the inverse of the convex corner.
 * Canonical (rotation-0) notch is at NE, and the resolver's `rotation` is the empty-diagonal index,
 * NE=0. The roof folds into two triangles that meet along the notch→far-corner diagonal; each roof
 * triangle shares exactly 1 vertex with the bottom (the notched corner).
 */
export function concaveCornerGeometry(rotation: 0 | 1 | 2 | 3 = 0): THREE.BufferGeometry {
  return buildGeometry(
    [
      // bottom (full footprint, z=-0.5)
      [b(0), b(3), b(2)],
      [b(0), b(2), b(1)],
      // east + north sloped-side triangles tapering down to the NE notch corner
      [b(0), b(1), t(1)], // east wall triangle
      [b(0), t(3), b(3)], // north wall triangle
      // south + west full-height walls (quads)
      [b(1), b(2), t(2)],
      [b(1), t(2), t(1)],
      [b(2), b(3), t(3)],
      [b(2), t(3), t(2)],
      // folded roof: two triangles meeting along the NE-notch → SW-top diagonal
      [b(0), t(1), t(2)],
      [b(0), t(2), t(3)],
    ],
    rotation,
  )
}
