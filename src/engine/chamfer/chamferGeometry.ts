import * as THREE from 'three'

/**
 * Local prefab space shared by all shapes: unit cell [0,1]^3.
 * x = u, y = v (the plane's in-plane axes), z = outward extent
 * (z=1 is flush with the construction plane / full height, z=0 is the inward base).
 * Per-instance placement (world axis mapping + orientation flip + baked rotation) is applied
 * afterward by the instancing manager — see engine/instancing/basis.ts.
 */

// Corner order: NE=0, SE=1, SW=2, NW=3 (clockwise from north-east) — shared with chamferResolver.
const CORNER_UV: Record<number, [number, number]> = {
  0: [1, 0], // NE
  1: [1, 1], // SE
  2: [0, 1], // SW
  3: [0, 0], // NW
}

// Side order: N=0, E=1, S=2, W=3 (clockwise from north) — shared with chamferResolver.
// Each side's two adjacent corner indices, in winding-consistent order.
const SIDE_CORNERS: Record<number, [number, number]> = {
  0: [3, 0], // N: NW, NE
  1: [0, 1], // E: NE, SE
  2: [1, 2], // S: SE, SW
  3: [2, 3], // W: SW, NW
}

function buildGeometry(triangles: number[][][]): THREE.BufferGeometry {
  const positions: number[] = []
  for (const tri of triangles) {
    for (const v of tri) positions.push(v[0], v[1], v[2])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function base(i: number): number[] {
  const [u, v] = CORNER_UV[i]
  return [u, v, 0]
}
function top(i: number): number[] {
  const [u, v] = CORNER_UV[i]
  return [u, v, 1]
}

export function unitCubeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1)
  g.translate(0.5, 0.5, 0.5)
  return g
}

/** Wedge: full height along the side opposite `openSide`, tapering to zero at `openSide`. */
export function rampGeometry(openSide: 0 | 1 | 2 | 3): THREE.BufferGeometry {
  const closedSide = ((openSide + 2) % 4) as 0 | 1 | 2 | 3
  const [tc0, tc1] = SIDE_CORNERS[closedSide]
  const [bc0, bc1] = SIDE_CORNERS[openSide]

  return buildGeometry([
    // bottom (full footprint, z=0)
    [base(0), base(1), base(2)],
    [base(0), base(2), base(3)],
    // closed-side wall (full height)
    [base(tc0), top(tc0), top(tc1)],
    [base(tc0), top(tc1), base(tc1)],
    // sloped roof, from the open (knife) edge up to the closed top edge
    [base(bc0), base(bc1), top(tc1)],
    [base(bc0), top(tc1), top(tc0)],
    // two triangular end caps — each connects one open-side corner to the closed-side
    // corner on the same side of the ramp (bc1↔tc0, bc0↔tc1), not diagonally across.
    [base(bc1), base(tc0), top(tc0)],
    [base(bc0), top(tc1), base(tc1)],
  ])
}

/** Single flat 45° corner cut: full height only at the corner opposite `openCorner`. */
export function convexCornerGeometry(openCorner: 0 | 1 | 2 | 3): THREE.BufferGeometry {
  const closedCorner = ((openCorner + 2) % 4) as 0 | 1 | 2 | 3
  // The two corners adjacent to the closed corner (one step around each way).
  const adjA = ((closedCorner + 1) % 4) as 0 | 1 | 2 | 3
  const adjB = ((closedCorner + 3) % 4) as 0 | 1 | 2 | 3

  return buildGeometry([
    // bottom (full footprint, z=0)
    [base(0), base(1), base(2)],
    [base(0), base(2), base(3)],
    // two walls meeting at the closed (full-height) corner
    [base(adjA), base(closedCorner), top(closedCorner)],
    [base(closedCorner), base(adjB), top(closedCorner)],
    // sloped roof cut
    [base(adjA), top(closedCorner), base(adjB)],
  ])
}

/**
 * Inverse of convex: full height along all 4 edges, notched down to the base only at the
 * point where `emptyDiagonal` sits. Approximated as two flat triangular facets (a shallow
 * fold), rather than a curved bilinear "scoop" — a standard low-poly simplification.
 */
export function concaveCornerGeometry(emptyDiagonal: 0 | 1 | 2 | 3): THREE.BufferGeometry {
  const e = emptyDiagonal
  // The 3 non-empty corners, in clockwise order starting after the notch.
  const c1 = ((e + 1) % 4) as 0 | 1 | 2 | 3
  const c2 = ((e + 2) % 4) as 0 | 1 | 2 | 3
  const c3 = ((e + 3) % 4) as 0 | 1 | 2 | 3

  const triangles: number[][][] = [
    // bottom (full footprint, z=0)
    [base(0), base(1), base(2)],
    [base(0), base(2), base(3)],
    // folded roof: flat full-height triangle + sloped triangle down to the notch
    [top(c1), top(c2), top(c3)],
    [top(c3), base(e), top(c1)],
  ]

  // The 2 sides not touching the notch get a full-height wall; the 2 sides touching it
  // get a triangular wall tapering down to the notch corner.
  for (let side = 0 as 0 | 1 | 2 | 3, i = 0; i < 4; i++, side = ((side + 1) % 4) as 0 | 1 | 2 | 3) {
    const [s0, s1] = SIDE_CORNERS[side]
    if (s0 === e) {
      triangles.push([base(s0), base(s1), top(s1)])
    } else if (s1 === e) {
      triangles.push([base(s0), base(s1), top(s0)])
    } else {
      triangles.push([base(s0), base(s1), top(s1)])
      triangles.push([base(s0), top(s1), top(s0)])
    }
  }

  return buildGeometry(triangles)
}
