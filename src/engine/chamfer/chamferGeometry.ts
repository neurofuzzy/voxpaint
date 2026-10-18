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
 * Model F — thin slab: a full-footprint box that is half-thickness (0.5) along the outward (z / W)
 * axis, centered on the origin (`z ∈ [-0.25, 0.25]`). In prefab space z is the plane's outward
 * normal, so the full 1×1 square u×v face points at the viewer while the slab sits centered in the
 * cell — a fin / inset-panel / glass block. Symmetric about z, so unlike the chamfer prefabs it
 * takes no `rotation`. Returned **non-indexed** (CCW-outward) so it drops straight into
 * `voxelMeshBuilder`'s `emitChamfer` triangle-soup loop.
 */
export function thinGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 0.5).toNonIndexed()
}

/**
 * Model G — half slab: a full-footprint box that is half-thickness (0.5) along the outward (z)
 * axis, flush with the outward face (`z ∈ [0, 0.5]`) rather than centered like the thin slab.
 * The authoring orientation picks the side (flipping `planeOrientation` moves the slab to the
 * other half — a geometry edit, so rebase tools refuse halves). Rotation is always 0; like
 * `thinGeometry` it is returned non-indexed for `voxelMeshBuilder`'s triangle-soup loop. Created
 * by project rescale (a doubled centered thin slab straddles the new layer boundary) and by the
 * half paint kind — never by the chamfer resolver.
 */
export function halfGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 0.5).toNonIndexed()
  geometry.translate(0, 0, 0.25)
  return geometry
}

/**
 * Model H — post: a centered square column, 0.5×0.5 in the plane's u×v footprint and running
 * the full unit length along the outward (z) axis. The centered sibling of the thin slab with
 * the axes swapped (thin is full-footprint × half-thickness; post is half-footprint ×
 * full-length). Fully symmetric about z and under quarter-turns about z, so like `thinGeometry`
 * it takes no `rotation` and paints frozen with `rotation: 0`. Returned non-indexed for
 * `voxelMeshBuilder`'s triangle-soup loop.
 */
export function postGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.5, 0.5, 1).toNonIndexed()
}

/**
 * Model I — quarter: the post pushed into one u×v corner — a 0.5×0.5×1 column occupying a
 * single quadrant of the cell, full length along the outward (z) axis. Canonical (rotation-0)
 * quadrant is NE (`u ∈ [0, 0.5]`, `v ∈ [-0.5, 0]`); `rotation` is the *occupied* corner index
 * (NE=0, SE=1, SW=2, NW=3 — the same corner order `classify` uses), baked with the same
 * `rotateZ` convention as the other prefabs so the instancing matrix's `Rz(rotation)` agrees.
 * Like `halfGeometry` it is returned non-indexed for `voxelMeshBuilder`'s triangle-soup loop.
 * Never resolver-created; only quarter paint (fresh paints start NE, re-click cycles corners).
 */
export function quarterGeometry(rotation: 0 | 1 | 2 | 3 = 0): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(0.5, 0.5, 1).toNonIndexed()
  geometry.translate(H / 2, -H / 2, 0)
  if (rotation) geometry.rotateZ((rotation * Math.PI) / 2)
  return geometry
}

/**
 * Model J — flat: `thin`'s centre plane as a bare quad — the u×v square at `z = 0`,
 * normal +z. Zero thickness: a true plane for glass panels and the like. Rendered
 * `DoubleSide` in the editor (single quad); export emits both windings (see
 * `voxelMeshBuilder`'s two-sided handling). Takes no `rotation`.
 */
export function flatGeometry(): THREE.BufferGeometry {
  const hw = H
  const positions = new Float32Array([
    -hw, -hw, 0, hw, -hw, 0, hw, hw, 0,
    -hw, -hw, 0, hw, hw, 0, -hw, hw, 0,
  ])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Model K — flat wedge: `wedge`'s diagonal cut face as a bare quad — the diagonal
 * through the cell centre, full depth (`b(3), b(1), t(1), t(3)`, NW to SE),
 * normal toward the open (NE) corner. Zero thickness; several stepping diagonally
 * (du = dv) tile into a continuous 45° pane. `rotation` is the open corner index
 * (NE=0, SE=1, SW=2, NW=3 — the wedge convention), baked with the same `rotateZ`
 * convention as the other prefabs. Never resolver-created.
 */
export function flatWedgeGeometry(rotation: 0 | 1 | 2 | 3 = 0): THREE.BufferGeometry {
  const geometry = buildGeometry(
    [
      [b(3), b(1), t(1)],
      [b(3), t(1), t(3)],
    ],
    rotation,
  )
  return geometry
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
 * Model E — corner wedge: a flat diagonal cut, constant through the full outward (z) depth (not a
 * spec model — an editor-only shortcut shape, see the `wedge` voxel-kind's use of this). 5 sides,
 * 8 triangles. Full height at both the west and south walls (they meet at a right-angle SW corner);
 * the NE corner is sliced away entirely by a single flat diagonal face — unlike `convexCornerGeometry`
 * (which keeps a base vertex at every corner and only omits the *top* vertex at the cut corner), this
 * shape has **no vertex at all**, top or bottom, at the cut corner. Canonical (rotation-0) walls are
 * W+S (meeting at SW); the resolver's `rotation` is the *open* (cut) corner index, NE=0 — same
 * convention as `convexCornerGeometry`, since both shapes cut the same corner for a given rotation.
 */
export function wedgeGeometry(rotation: 0 | 1 | 2 | 3 = 0): THREE.BufferGeometry {
  return buildGeometry(
    [
      // bottom (triangular footprint, z=-0.5) — SE, SW, NW only, no NE
      [b(3), b(2), b(1)],
      // top (triangular footprint, z=+0.5)
      [t(1), t(2), t(3)],
      // west wall (flush quad, full height) — matches a filled W neighbor
      [b(3), t(3), t(2)],
      [b(3), t(2), b(2)],
      // south wall (flush quad, full height) — matches a filled S neighbor
      [b(2), t(2), t(1)],
      [b(2), t(1), b(1)],
      // diagonal cut face (open, full height) — the exposed "/"-or-"\" edge, cut corner NE
      [b(3), b(1), t(1)],
      [b(3), t(1), t(3)],
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
