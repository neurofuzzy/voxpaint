import * as THREE from 'three';

const EPSILON = 1e-5;
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

interface CSGVertex {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  uv?: THREE.Vector2;
  materialIndex?: number;
}

interface CSGPolygon {
  vertices: CSGVertex[];
  normal: THREE.Vector3;
  w: number;
  materialIndex?: number;
}

class BSPNode {
  plane?: CSGPolygon;
  front?: BSPNode;
  back?: BSPNode;
  polygons: CSGPolygon[] = [];

  constructor(polygons?: CSGPolygon[]) {
    if (polygons) {
      this.build(polygons);
    }
  }

  clone(): BSPNode {
    const node = new BSPNode();
    node.plane = this.plane;
    node.front = this.front?.clone();
    node.back = this.back?.clone();
    node.polygons = this.polygons.slice();
    return node;
  }

  invert(): void {
    for (let i = 0; i < this.polygons.length; i++) {
      this.polygons[i] = this.flipPolygon(this.polygons[i]);
    }

    if (this.plane) {
      this.plane = this.flipPolygon(this.plane);
    }

    if (this.front) {
      this.front.invert();
    }
    if (this.back) {
      this.back.invert();
    }

    const temp = this.front;
    this.front = this.back;
    this.back = temp;
  }

  clipPolygons(polygons: CSGPolygon[]): CSGPolygon[] {
    if (!this.plane) {
      return polygons.slice();
    }

    let front: CSGPolygon[] = [];
    let back: CSGPolygon[] = [];

    for (let i = 0; i < polygons.length; i++) {
      this.splitPolygon(polygons[i], front, back, front, back);
    }

    if (this.front) {
      front = this.front.clipPolygons(front);
    }
    if (this.back) {
      back = this.back.clipPolygons(back);
    } else {
      back = [];
    }

    return front.concat(back);
  }

  clipTo(bsp: BSPNode): void {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) {
      this.front.clipTo(bsp);
    }
    if (this.back) {
      this.back.clipTo(bsp);
    }
  }

  allPolygons(): CSGPolygon[] {
    let polygons = this.polygons.slice();
    if (this.front) {
      polygons = polygons.concat(this.front.allPolygons());
    }
    if (this.back) {
      polygons = polygons.concat(this.back.allPolygons());
    }
    return polygons;
  }

  build(polygons: CSGPolygon[]): void {
    if (!polygons.length) {
      return;
    }

    if (!this.plane) {
      this.plane = this.clonePolygon(polygons[0]);
    }

    const front: CSGPolygon[] = [];
    const back: CSGPolygon[] = [];

    for (let i = 0; i < polygons.length; i++) {
      this.splitPolygon(polygons[i], this.polygons, this.polygons, front, back);
    }

    if (front.length) {
      if (!this.front) {
        this.front = new BSPNode();
      }
      this.front.build(front);
    }

    if (back.length) {
      if (!this.back) {
        this.back = new BSPNode();
      }
      this.back.build(back);
    }
  }

  private splitPolygon(
    polygon: CSGPolygon,
    coplanarFront: CSGPolygon[],
    coplanarBack: CSGPolygon[],
    front: CSGPolygon[],
    back: CSGPolygon[]
  ): void {
    if (!this.plane) {
      return;
    }

    let polygonType = 0;
    const types: number[] = [];

    for (let i = 0; i < polygon.vertices.length; i++) {
      const t = this.plane.normal.dot(polygon.vertices[i].pos) - this.plane.w;
      const type = t < -EPSILON ? BACK : t > EPSILON ? FRONT : COPLANAR;
      polygonType |= type;
      types.push(type);
    }

    switch (polygonType) {
      case COPLANAR:
        (this.plane.normal.dot(polygon.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
        break;
      case FRONT:
        front.push(polygon);
        break;
      case BACK:
        back.push(polygon);
        break;
      case SPANNING:
        const f: CSGVertex[] = [];
        const b: CSGVertex[] = [];

        for (let i = 0; i < polygon.vertices.length; i++) {
          const j = (i + 1) % polygon.vertices.length;
          const ti = types[i];
          const tj = types[j];
          const vi = polygon.vertices[i];
          const vj = polygon.vertices[j];

          if (ti !== BACK) {
            f.push(vi);
          }
          if (ti !== FRONT) {
            b.push(ti !== BACK ? this.cloneVertex(vi) : vi);
          }

          if ((ti | tj) === SPANNING) {
            const t =
              (this.plane.w - this.plane.normal.dot(vi.pos)) /
              this.plane.normal.dot(new THREE.Vector3().subVectors(vj.pos, vi.pos));

            const vertex: CSGVertex = {
              pos: new THREE.Vector3().lerpVectors(vi.pos, vj.pos, t),
              normal: new THREE.Vector3().lerpVectors(vi.normal, vj.normal, t).normalize(),
              materialIndex: vi.materialIndex
            };

            if (vi.uv && vj.uv) {
              vertex.uv = new THREE.Vector2().lerpVectors(vi.uv, vj.uv, t);
            }

            f.push(vertex);
            b.push(this.cloneVertex(vertex));
          }
        }

        if (f.length >= 3) {
          front.push(this.createPolygon(f, polygon.materialIndex));
        }
        if (b.length >= 3) {
          back.push(this.createPolygon(b, polygon.materialIndex));
        }
        break;
    }
  }

  private flipPolygon(polygon: CSGPolygon): CSGPolygon {
    const vertices = polygon.vertices.slice().reverse().map(v => ({
      pos: v.pos.clone(),
      normal: v.normal.clone().negate(),
      uv: v.uv?.clone(),
      materialIndex: v.materialIndex
    }));

    return {
      vertices,
      normal: polygon.normal.clone().negate(),
      w: -polygon.w,
      materialIndex: polygon.materialIndex
    };
  }

  private clonePolygon(polygon: CSGPolygon): CSGPolygon {
    return {
      vertices: polygon.vertices.map(v => this.cloneVertex(v)),
      normal: polygon.normal.clone(),
      w: polygon.w,
      materialIndex: polygon.materialIndex
    };
  }

  private cloneVertex(vertex: CSGVertex): CSGVertex {
    return {
      pos: vertex.pos.clone(),
      normal: vertex.normal.clone(),
      uv: vertex.uv?.clone(),
      materialIndex: vertex.materialIndex
    };
  }

  private createPolygon(vertices: CSGVertex[], materialIndex?: number): CSGPolygon {
    const normal = new THREE.Vector3();
    const a = new THREE.Vector3().subVectors(vertices[1].pos, vertices[0].pos);
    const b = new THREE.Vector3().subVectors(vertices[2].pos, vertices[0].pos);
    normal.crossVectors(a, b).normalize();

    return {
      vertices,
      normal,
      w: normal.dot(vertices[0].pos),
      materialIndex
    };
  }
}

export default class ThreeBSP {
  public tree: BSPNode;
  public matrix: THREE.Matrix4;
  public static MatIdx: number = 0;

  constructor(geometry: THREE.BufferGeometry | THREE.Mesh, matIdx?: number) {
    this.matrix = new THREE.Matrix4();

    if (geometry instanceof THREE.Mesh) {
      geometry.updateMatrix();
      this.matrix = geometry.matrix.clone();
      geometry = geometry.geometry;
    } else if (geometry instanceof BSPNode) {
      this.tree = geometry as any;
      return;
    }

    if (!isNaN(matIdx!)) {
      ThreeBSP.MatIdx = matIdx!;
    }

    const polygons = this.geometryToPolygons(geometry as THREE.BufferGeometry, matIdx);
    this.tree = new BSPNode(polygons);
  }

  private geometryToPolygons(geometry: THREE.BufferGeometry, materialIndex?: number): CSGPolygon[] {
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const indexAttr = geometry.getIndex();

    if (!positionAttr) {
      // console.warn('Geometry has no position attribute');
      return [];
    }

    const polygons: CSGPolygon[] = [];
    const vertexCount = indexAttr ? indexAttr.count : positionAttr.count;

    for (let i = 0; i < vertexCount; i += 3) {
      const vertices: CSGVertex[] = [];

      for (let j = 0; j < 3; j++) {
        const index = indexAttr ? indexAttr.getX(i + j) : i + j;

        const vertex: CSGVertex = {
          pos: new THREE.Vector3().fromBufferAttribute(positionAttr, index),
          normal: normalAttr
            ? new THREE.Vector3().fromBufferAttribute(normalAttr, index)
            : new THREE.Vector3(0, 1, 0),
          materialIndex
        };

        if (uvAttr) {
          vertex.uv = new THREE.Vector2().fromBufferAttribute(uvAttr, index);
        }

        vertex.pos.applyMatrix4(this.matrix);
        vertex.normal.transformDirection(this.matrix);

        vertices.push(vertex);
      }

      if (vertices.length === 3) {
        polygons.push(this.createPolygonFromVertices(vertices, materialIndex));
      }
    }

    return polygons;
  }

  private createPolygonFromVertices(vertices: CSGVertex[], materialIndex?: number): CSGPolygon {
    const normal = new THREE.Vector3();
    const a = new THREE.Vector3().subVectors(vertices[1].pos, vertices[0].pos);
    const b = new THREE.Vector3().subVectors(vertices[2].pos, vertices[0].pos);
    normal.crossVectors(a, b).normalize();

    return {
      vertices,
      normal,
      w: normal.dot(vertices[0].pos),
      materialIndex
    };
  }

  subtract(other: ThreeBSP): ThreeBSP {
    const a = this.tree.clone();
    const b = other.tree.clone();

    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();

    const result = new ThreeBSP(new THREE.BufferGeometry());
    result.tree = a;
    result.matrix = this.matrix.clone();
    return result;
  }

  union(other: ThreeBSP): ThreeBSP {
    const a = this.tree.clone();
    const b = other.tree.clone();

    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());

    const result = new ThreeBSP(new THREE.BufferGeometry());
    result.tree = a;
    result.matrix = this.matrix.clone();
    return result;
  }

  intersect(other: ThreeBSP): ThreeBSP {
    const a = this.tree.clone();
    const b = other.tree.clone();

    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.allPolygons());
    a.invert();

    const result = new ThreeBSP(new THREE.BufferGeometry());
    result.tree = a;
    result.matrix = this.matrix.clone();
    return result;
  }

  toGeometry(): THREE.BufferGeometry {
    const polygons = this.tree.allPolygons();
    const geometry = new THREE.BufferGeometry();

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const materialGroups: Array<{ start: number; count: number; materialIndex: number }> = [];

    let currentMaterialIndex = -1;
    let groupStart = 0;
    let vertexIndex = 0;

    for (let i = 0; i < polygons.length; i++) {
      const polygon = polygons[i];
      const materialIndex = polygon.materialIndex || 0;

      // Handle material groups
      if (materialIndex !== currentMaterialIndex) {
        if (currentMaterialIndex !== -1 && vertexIndex > groupStart) {
          materialGroups.push({
            start: groupStart,
            count: vertexIndex - groupStart,
            materialIndex: currentMaterialIndex
          });
        }
        currentMaterialIndex = materialIndex;
        groupStart = vertexIndex;
      }

      // Triangulate polygon (assuming convex)
      for (let j = 2; j < polygon.vertices.length; j++) {
        const vertices = [
          polygon.vertices[0],
          polygon.vertices[j - 1],
          polygon.vertices[j]
        ];

        for (const vertex of vertices) {
          positions.push(vertex.pos.x, vertex.pos.y, vertex.pos.z);
          normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);

          if (vertex.uv) {
            uvs.push(vertex.uv.x, vertex.uv.y);
          } else {
            uvs.push(0, 0);
          }

          vertexIndex++;
        }
      }
    }

    // Add final material group
    if (currentMaterialIndex !== -1 && vertexIndex > groupStart) {
      materialGroups.push({
        start: groupStart,
        count: vertexIndex - groupStart,
        materialIndex: currentMaterialIndex
      });
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    if (uvs.length > 0) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }

    // Add material groups
    for (const group of materialGroups) {
      geometry.addGroup(group.start, group.count, group.materialIndex);
    }

    // Transform geometry back to local space
    const matrix = new THREE.Matrix4().copy(this.matrix).invert();
    geometry.applyMatrix4(matrix);

    return geometry;
  }
}

export function ThreeCSGFactory(_THREE: any) {
  return ThreeBSP;
}
