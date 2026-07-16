import * as THREE from 'three';
import earcut from 'earcut';

/**
 * Mesh optimization utility for reducing redundant geometry from CSG operations
 * Merges coplanar faces while preserving vertex attributes (materials, UVs, etc.)
 */
export default class MeshOptimizer {
  private static readonly COPLANAR_THRESHOLD = 1e-5;
  private static readonly NORMAL_THRESHOLD = 0.9999; // ~0.8 degrees

  /**
   * Optimize a BufferGeometry by merging coplanar faces
   * Preserves all vertex attributes including semantic brush data
   *
   * @param geometry - The geometry to optimize
   * @returns Optimized geometry with merged coplanar faces
   */
  public static optimizeGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    const startTime = performance.now();

    // Extract vertex data
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute;

    // Extract semantic brush attributes if present
    const brushColorSlotAttr = geometry.getAttribute('brushColorSlot') as THREE.BufferAttribute;
    const brushTextureAttr = geometry.getAttribute('brushTexture') as THREE.BufferAttribute;
    const brushMetallicAttr = geometry.getAttribute('brushMetallic') as THREE.BufferAttribute;

    if (!positionAttr || !normalAttr) {
      console.warn('MeshOptimizer: Missing required attributes');
      return geometry;
    }

    const vertexCount = positionAttr.count;
    const triangleCount = vertexCount / 3;

    // Build triangle data
    interface Triangle {
      indices: number[];
      normal: THREE.Vector3;
      plane: THREE.Plane;
      vertices: THREE.Vector3[];
      uvs?: THREE.Vector2[];
      brushColorSlot?: number;
      brushTexture?: number;
      brushMetallic?: number;
      merged: boolean;
    }

    const triangles: Triangle[] = [];

    for (let i = 0; i < triangleCount; i++) {
      const i0 = i * 3;
      const i1 = i * 3 + 1;
      const i2 = i * 3 + 2;

      const v0 = new THREE.Vector3().fromBufferAttribute(positionAttr, i0);
      const v1 = new THREE.Vector3().fromBufferAttribute(positionAttr, i1);
      const v2 = new THREE.Vector3().fromBufferAttribute(positionAttr, i2);

      // Use the actual normals from the geometry (CSG already computed these correctly)
      const n0 = new THREE.Vector3().fromBufferAttribute(normalAttr, i0);
      const n1 = new THREE.Vector3().fromBufferAttribute(normalAttr, i1);
      const n2 = new THREE.Vector3().fromBufferAttribute(normalAttr, i2);

      // For flat-shaded geometry (CSG output), all vertex normals should be the same
      // Use the first vertex's normal as the face normal
      const normal = n0.clone().normalize();

      // Create plane from triangle
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, v0);

      const triangle: Triangle = {
        indices: [i0, i1, i2],
        normal,
        plane,
        vertices: [v0, v1, v2],
        merged: false
      };

      // Store UVs if present
      if (uvAttr) {
        triangle.uvs = [
          new THREE.Vector2().fromBufferAttribute(uvAttr, i0),
          new THREE.Vector2().fromBufferAttribute(uvAttr, i1),
          new THREE.Vector2().fromBufferAttribute(uvAttr, i2)
        ];
      }

      // Store semantic brush data if present (assumes all vertices in triangle share same brush)
      if (brushColorSlotAttr) {
        triangle.brushColorSlot = brushColorSlotAttr.getX(i0);
      }
      if (brushTextureAttr) {
        triangle.brushTexture = brushTextureAttr.getX(i0);
      }
      if (brushMetallicAttr) {
        triangle.brushMetallic = brushMetallicAttr.getX(i0);
      }

      triangles.push(triangle);
    }

    // Group triangles by coplanarity, material, AND connectivity
    const groups: Triangle[][] = [];

    for (const triangle of triangles) {
      if (triangle.merged) continue;

      // Find or create group for this triangle
      let foundGroup = false;

      for (const group of groups) {
        const firstTriangle = group[0];

        // Check if coplanar
        const normalDot = triangle.normal.dot(firstTriangle.normal);
        const isCoplanar = normalDot > this.NORMAL_THRESHOLD;

        if (!isCoplanar) continue;

        // Check plane distance
        const distanceToPlane = Math.abs(firstTriangle.plane.distanceToPoint(triangle.vertices[0]));
        if (distanceToPlane > this.COPLANAR_THRESHOLD) continue;

        // Check material match
        const materialMatch =
          triangle.brushColorSlot === firstTriangle.brushColorSlot &&
          triangle.brushTexture === firstTriangle.brushTexture &&
          triangle.brushMetallic === firstTriangle.brushMetallic;

        if (!materialMatch) continue;

        // CRITICAL: Check if triangle is connected to any triangle in the group
        // Only merge triangles that share edges (prevents merging separate coplanar regions)
        const isConnected = group.some(groupTriangle =>
          this.trianglesShareEdge(triangle, groupTriangle)
        );

        if (!isConnected) continue;

        // Add to group
        group.push(triangle);
        foundGroup = true;
        break;
      }

      if (!foundGroup) {
        groups.push([triangle]);
      }
    }

    // Merge triangles within each group
    const optimizedTriangles: Triangle[] = [];
    let mergedCount = 0;

    for (const group of groups) {
      if (group.length === 1) {
        // Single triangle, keep as-is
        optimizedTriangles.push(group[0]);
      } else {
        // Multiple coplanar triangles - try to merge
        const merged = this.mergeCoplanarTriangles(group);
        optimizedTriangles.push(...merged);
        mergedCount += group.length - merged.length;
      }
    }

    // Build optimized geometry
    const optimizedGeometry = this.buildGeometryFromTriangles(optimizedTriangles);

    const endTime = performance.now();
    const reduction = ((triangleCount - optimizedTriangles.length) / triangleCount * 100).toFixed(1);

    console.log(`🔧 Mesh optimization: ${triangleCount} → ${optimizedTriangles.length} triangles (${reduction}% reduction) in ${(endTime - startTime).toFixed(1)}ms`);
    console.log(`🔧 Merged ${mergedCount} triangles into ${groups.length} groups`);

    // Debug: log some sample normals
    if (optimizedTriangles.length > 0) {
      const sampleNormals = optimizedTriangles.slice(0, Math.min(5, optimizedTriangles.length))
        .map((t, i) => `  [${i}] normal: (${t.normal.x.toFixed(3)}, ${t.normal.y.toFixed(3)}, ${t.normal.z.toFixed(3)})`);
      console.log(`🔧 Sample normals:\n${sampleNormals.join('\n')}`);
    }

    return optimizedGeometry;
  }

  /**
   * Merge coplanar triangles into larger polygons, then re-triangulate
   */
  private static mergeCoplanarTriangles(triangles: any[]): any[] {
    if (triangles.length <= 1) return triangles;

    // Collect all unique vertices from the triangle group
    const vertexMap = new Map<string, THREE.Vector3>();
    const edges = new Map<string, number>(); // Edge -> count (1 = boundary, 2 = interior)

    for (const triangle of triangles) {
      const verts = triangle.vertices;

      // Add vertices to map (deduplicate by position)
      for (const v of verts) {
        const key = this.vertexKey(v);
        if (!vertexMap.has(key)) {
          vertexMap.set(key, v);
        }
      }

      // Track edges
      for (let i = 0; i < 3; i++) {
        const v1 = verts[i];
        const v2 = verts[(i + 1) % 3];
        const edgeKey = this.edgeKey(v1, v2);
        edges.set(edgeKey, (edges.get(edgeKey) || 0) + 1);
      }
    }

    // Find boundary edges (edges that appear only once)
    const boundaryEdges = new Map<string, [THREE.Vector3, THREE.Vector3]>();

    for (const [edgeKey, count] of edges.entries()) {
      if (count === 1) { // Boundary edge
        const [v1Key, v2Key] = edgeKey.split('|');
        const v1 = vertexMap.get(v1Key)!;
        const v2 = vertexMap.get(v2Key)!;
        boundaryEdges.set(edgeKey, [v1, v2]);
      }
    }

    // Extract multiple separate boundary loops (outer boundary + holes)
    const boundaryLoops: THREE.Vector3[][] = [];
    const usedEdges = new Set<string>();

    for (const [edgeKey, [v1, v2]] of boundaryEdges.entries()) {
      if (usedEdges.has(edgeKey)) continue;

      // Start a new loop from this edge
      const loop: THREE.Vector3[] = [];
      const loopEdges = new Map<string, [THREE.Vector3, THREE.Vector3]>();

      // Collect all edges for this loop by walking connected boundary edges
      const edgesToProcess = [edgeKey];
      while (edgesToProcess.length > 0) {
        const currentEdge = edgesToProcess.pop()!;
        if (usedEdges.has(currentEdge)) continue;

        usedEdges.add(currentEdge);
        const edge = boundaryEdges.get(currentEdge)!;
        loopEdges.set(currentEdge, edge);

        // Find connected boundary edges
        for (const [otherEdgeKey, otherEdge] of boundaryEdges.entries()) {
          if (usedEdges.has(otherEdgeKey)) continue;

          // Check if edges share a vertex
          const [v1, v2] = edge;
          const [ov1, ov2] = otherEdge;
          if (this.vertexKey(v1) === this.vertexKey(ov1) || this.vertexKey(v1) === this.vertexKey(ov2) ||
              this.vertexKey(v2) === this.vertexKey(ov1) || this.vertexKey(v2) === this.vertexKey(ov2)) {
            edgesToProcess.push(otherEdgeKey);
          }
        }
      }

      // Order this loop's vertices
      const loopVertexSet = new Set<string>();
      for (const [v1, v2] of loopEdges.values()) {
        loopVertexSet.add(this.vertexKey(v1));
        loopVertexSet.add(this.vertexKey(v2));
      }
      const loopVertices = Array.from(loopVertexSet).map(key => vertexMap.get(key)!);
      const orderedLoop = this.orderBoundaryVertices(loopVertices, edges);

      if (orderedLoop.length >= 3) {
        boundaryLoops.push(orderedLoop);
      }
    }

    if (boundaryLoops.length === 0) {
      return triangles;
    }

    const reference = triangles[0];
    const normal = reference.normal;

    // Simplify each loop
    const simplifiedLoops = boundaryLoops.map(loop =>
      this.simplifyCollinearVertices(loop, normal)
    );

    // Use simplified loops (or original if simplification made them too small)
    const finalLoops = simplifiedLoops.map((simplified, i) =>
      simplified.length >= 3 ? simplified : boundaryLoops[i]
    ).filter(loop => loop.length >= 3);

    // Project 3D boundary vertices onto 2D plane for triangulation
    // Create a local 2D coordinate system on the plane that's consistently right-handed
    // Choose initial tangent perpendicular to normal
    let tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tangent)) > 0.9) {
      tangent.set(0, 1, 0);
    }

    // Make tangent perpendicular to normal
    tangent.sub(normal.clone().multiplyScalar(normal.dot(tangent))).normalize();

    // Create bitangent to form right-handed coordinate system
    // Using normal × tangent ensures consistent orientation
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    // Project all loops to 2D and build flat coordinate array + hole indices
    const coords2D: number[] = [];
    const holeIndices: number[] = [];
    const allVertices: THREE.Vector3[] = [];

    for (let loopIdx = 0; loopIdx < finalLoops.length; loopIdx++) {
      const loop = finalLoops[loopIdx];

      // If this is not the first loop, it's a hole - record the starting index
      if (loopIdx > 0) {
        holeIndices.push(coords2D.length / 2);
      }

      for (const v of loop) {
        const x = v.dot(tangent);
        const y = v.dot(bitangent);
        coords2D.push(x, y);
        allVertices.push(v);
      }
    }

    console.log(`🔧 Triangulating ${finalLoops.length} loop(s): outer=${finalLoops[0].length} verts${holeIndices.length > 0 ? `, holes=${holeIndices.join(',')}` : ''}`);

    // Use earcut for robust triangulation (handles concave polygons with holes!)
    const indices = earcut(coords2D, holeIndices.length > 0 ? holeIndices : undefined);

    if (indices.length === 0) {
      console.warn(`⚠️ Earcut failed to triangulate ${finalLoops.length} loop(s)`);
      return triangles; // Fall back to original triangles
    }

    // Build triangles from indices
    const newTriangles: any[] = [];

    for (let i = 0; i < indices.length; i += 3) {
      const v0 = allVertices[indices[i]];
      const v1 = allVertices[indices[i + 1]];
      const v2 = allVertices[indices[i + 2]];

      // Calculate normal to verify winding order
      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const calculatedNormal = new THREE.Vector3().crossVectors(edge1, edge2);

      // Normalize for proper comparison
      if (calculatedNormal.lengthSq() > 0) {
        calculatedNormal.normalize();
      }

      // Verify winding order matches the expected normal
      // Earcut produces CCW triangulation in 2D, but mapping to 3D can flip it
      let vertices: THREE.Vector3[];
      const dotCheck = calculatedNormal.dot(reference.normal);

      if (dotCheck < -0.5) {  // Use threshold to avoid numerical errors
        // Wrong orientation - swap v1 and v2 to fix winding order
        vertices = [v0, v2, v1];  // Reversed order
        if (i === 0) { // Only log for first triangle to avoid spam
          console.log(`🔁 Flipping triangle winding (dot: ${dotCheck.toFixed(4)}, normal: (${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}))`);
        }
      } else {
        // Correct orientation
        vertices = [v0, v1, v2];
      }

      // Always use the reference normal (from original CSG geometry)
      newTriangles.push({
        vertices,
        normal: reference.normal.clone(),
        plane: reference.plane,
        uvs: reference.uvs ? [
          this.interpolateUV(vertices[0], reference),
          this.interpolateUV(vertices[1], reference),
          this.interpolateUV(vertices[2], reference)
        ] : undefined,
        brushColorSlot: reference.brushColorSlot,
        brushTexture: reference.brushTexture,
        brushMetallic: reference.brushMetallic,
        merged: false
      });
    }

    return newTriangles.length > 0 ? newTriangles : triangles;
  }

  /**
   * Check if two triangles share an edge
   */
  private static trianglesShareEdge(t1: any, t2: any): boolean {
    const edges1 = [
      this.edgeKey(t1.vertices[0], t1.vertices[1]),
      this.edgeKey(t1.vertices[1], t1.vertices[2]),
      this.edgeKey(t1.vertices[2], t1.vertices[0])
    ];

    const edges2 = [
      this.edgeKey(t2.vertices[0], t2.vertices[1]),
      this.edgeKey(t2.vertices[1], t2.vertices[2]),
      this.edgeKey(t2.vertices[2], t2.vertices[0])
    ];

    // Check if any edges match
    for (const e1 of edges1) {
      if (edges2.includes(e1)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Order boundary vertices to form a continuous loop
   */
  private static orderBoundaryVertices(vertices: THREE.Vector3[], edges: Map<string, number>): THREE.Vector3[] {
    if (vertices.length <= 3) return vertices;

    // Build adjacency map for boundary edges
    const adjacency = new Map<string, string[]>();

    for (const [edgeKey, count] of edges.entries()) {
      if (count === 1) { // Boundary edge
        const [v1Key, v2Key] = edgeKey.split('|');

        if (!adjacency.has(v1Key)) adjacency.set(v1Key, []);
        if (!adjacency.has(v2Key)) adjacency.set(v2Key, []);

        adjacency.get(v1Key)!.push(v2Key);
        adjacency.get(v2Key)!.push(v1Key);
      }
    }

    // Build ordered loop starting from first vertex
    const ordered: THREE.Vector3[] = [];
    const startKey = this.vertexKey(vertices[0]);
    let currentKey = startKey;
    const visited = new Set<string>();

    const vertexByKey = new Map<string, THREE.Vector3>();
    for (const v of vertices) {
      vertexByKey.set(this.vertexKey(v), v);
    }

    while (ordered.length < vertices.length) {
      visited.add(currentKey);
      ordered.push(vertexByKey.get(currentKey)!);

      const neighbors = adjacency.get(currentKey) || [];
      let nextKey: string | null = null;

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          nextKey = neighbor;
          break;
        }
      }

      if (!nextKey) break;
      currentKey = nextKey;
    }

    return ordered.length >= 3 ? ordered : vertices;
  }

  /**
   * Simplify boundary by removing collinear vertices
   */
  private static simplifyCollinearVertices(vertices: THREE.Vector3[], normal: THREE.Vector3): THREE.Vector3[] {
    if (vertices.length <= 3) return vertices;

    const simplified: THREE.Vector3[] = [];
    const threshold = 0.9999; // ~0.8 degrees

    for (let i = 0; i < vertices.length; i++) {
      const prev = vertices[(i - 1 + vertices.length) % vertices.length];
      const curr = vertices[i];
      const next = vertices[(i + 1) % vertices.length];

      const edge1 = new THREE.Vector3().subVectors(curr, prev).normalize();
      const edge2 = new THREE.Vector3().subVectors(next, curr).normalize();

      const dot = edge1.dot(edge2);

      // Keep vertex if it's a corner (not collinear)
      if (Math.abs(dot) < threshold) {
        simplified.push(curr);
      }
    }

    return simplified.length >= 3 ? simplified : vertices;
  }

  /**
   * Create a unique key for a vertex based on position
   */
  private static vertexKey(v: THREE.Vector3): string {
    const precision = 1000000;
    return `${Math.round(v.x * precision)},${Math.round(v.y * precision)},${Math.round(v.z * precision)}`;
  }

  /**
   * Create a unique key for an edge (order-independent)
   */
  private static edgeKey(v1: THREE.Vector3, v2: THREE.Vector3): string {
    const k1 = this.vertexKey(v1);
    const k2 = this.vertexKey(v2);
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  }

  /**
   * Calculate centroid of vertices
   */
  private static calculateCentroid(vertices: THREE.Vector3[]): THREE.Vector3 {
    const centroid = new THREE.Vector3();
    for (const v of vertices) {
      centroid.add(v);
    }
    centroid.divideScalar(vertices.length);
    return centroid;
  }

  /**
   * Interpolate UV coordinates for a vertex (simplified - just use first triangle's UV)
   */
  private static interpolateUV(vertex: THREE.Vector3, reference: any): THREE.Vector2 {
    // For now, just return the first UV if available
    return reference.uvs?.[0] || new THREE.Vector2(0, 0);
  }

  /**
   * Build BufferGeometry from triangle list
   */
  private static buildGeometryFromTriangles(triangles: any[]): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const brushColorSlots: number[] = [];
    const brushTextures: number[] = [];
    const brushMetallics: number[] = [];

    for (const triangle of triangles) {
      for (let i = 0; i < 3; i++) {
        const v = triangle.vertices[i];
        positions.push(v.x, v.y, v.z);
        normals.push(triangle.normal.x, triangle.normal.y, triangle.normal.z);

        if (triangle.uvs) {
          uvs.push(triangle.uvs[i].x, triangle.uvs[i].y);
        }

        if (triangle.brushColorSlot !== undefined) {
          brushColorSlots.push(triangle.brushColorSlot);
        }
        if (triangle.brushTexture !== undefined) {
          brushTextures.push(triangle.brushTexture);
        }
        if (triangle.brushMetallic !== undefined) {
          brushMetallics.push(triangle.brushMetallic);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    if (uvs.length > 0) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }

    if (brushColorSlots.length > 0) {
      geometry.setAttribute('brushColorSlot', new THREE.Float32BufferAttribute(brushColorSlots, 1));
    }
    if (brushTextures.length > 0) {
      geometry.setAttribute('brushTexture', new THREE.Float32BufferAttribute(brushTextures, 1));
    }
    if (brushMetallics.length > 0) {
      geometry.setAttribute('brushMetallic', new THREE.Float32BufferAttribute(brushMetallics, 1));
    }

    return geometry;
  }

  /**
   * Get triangle count from geometry
   */
  public static getTriangleCount(geometry: THREE.BufferGeometry): number {
    const positionAttr = geometry.getAttribute('position');
    if (!positionAttr) return 0;

    const indexAttr = geometry.getIndex();
    if (indexAttr) {
      return indexAttr.count / 3;
    }

    return positionAttr.count / 3;
  }

  /**
   * Get vertex count from geometry
   */
  public static getVertexCount(geometry: THREE.BufferGeometry): number {
    const positionAttr = geometry.getAttribute('position');
    return positionAttr ? positionAttr.count : 0;
  }
}
