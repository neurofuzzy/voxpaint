import * as THREE from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import type { VoxelModel } from '@/engine/grid/types'
import type { PaletteState } from '@/engine/palette/types'
import { buildOptimizedVoxelGeometryByMaterial } from '@/engine/instancing/voxelMeshBuilder'

/**
 * STL export — a print-oriented sibling of `gltfExport.ts`, reusing the same watertight,
 * CSG-unioned per-(materialClass, colorKey) geometry the PBR GLTF path builds (chamfers included:
 * they're unioned by the same pass). STL carries no material/color at all, so unlike the GLTF
 * exporter this only ever needs position + normal, and simply concatenates every kept group's mesh
 * into one scene — `STLExporter` merges multiple mesh children into a single solid on its own.
 */

export type StlExportAnchor = 'center' | 'bottom' | 'back'

export type StlExportOptions = {
  /** Scale factor as a percentage (1–1000, default 100 = no scaling). */
  scaleFactor?: number
  /** Anchor point, relative to the voxels' own AABB (always — there's no legacy raw-canvas-position
   * mode to preserve here, unlike the GLTF exporter's default). */
  anchor?: StlExportAnchor
  /** Omit glass voxels entirely (default false). Glass geometry is deliberately never CSG-unioned
   * with its neighbours (see `meshOptimizer.ts`'s `removeOccludedGlassFaces`) — safe to merge into
   * a multi-material scene where a touching neighbour's own face closes the seam, but not something
   * you'd want printed as if it were solid opaque material. Skipping it sidesteps the question
   * entirely rather than trying to reconstruct a standalone-watertight glass shell. */
  skipGlass?: boolean
  /** Rotate the model so a cube's body diagonal aligns with the vertical (print) axis, standing it
   * up on one corner instead of resting flat on a face. A plain 45°/45° double-axis rotation still
   * leaves two of the six face directions at exactly the classic 45°-from-vertical support
   * threshold; 45° about one axis + arctan(1/√2) (~35.264°) about the perpendicular axis is the
   * exact pair that puts *every* face at the same, uniformly safe ~54.7°/35.3° angle — the standard
   * "print on the corner" trick for blocky/voxel models. Doesn't touch the chamfer system (it's a
   * transform on the already-built export mesh, not the paint-time chamfer bake), and doesn't
   * remove the voxel stair-stepping — it just changes it from axis-aligned to diagonal. */
  orientForPrinting?: boolean
}

const PRINT_ORIENT_Z = Math.PI / 4
const PRINT_ORIENT_X = Math.atan(1 / Math.SQRT2)

/** Build the export scene and serialize it to a binary STL ArrayBuffer. */
export function exportModelToStl(model: VoxelModel, palette: PaletteState, options: StlExportOptions = {}): ArrayBuffer {
  const groups = buildOptimizedVoxelGeometryByMaterial(model, palette, true)
  const geometries: THREE.BufferGeometry[] = []
  const content = new THREE.Group()

  try {
    for (const { geometry, materialClass } of groups) {
      if (options.skipGlass && materialClass === 'glass') {
        geometry.dispose()
        continue
      }
      geometries.push(geometry)
      content.add(new THREE.Mesh(geometry))
    }

    if (content.children.length === 0) {
      throw new Error(options.skipGlass ? 'Nothing to export — the model is only glass.' : 'Nothing to export — the model is empty.')
    }

    // Center at the model's own AABB origin first (regardless of anchor) so both the print-
    // orientation rotation and the anchor offsets below are relative to the voxels themselves, not
    // wherever they happen to sit on the (canvas-relative, potentially off-center) construction grid.
    const box = new THREE.Box3().setFromObject(content)
    const center = box.getCenter(new THREE.Vector3())
    content.position.sub(center)

    if (options.orientForPrinting) {
      const rotation = new THREE.Matrix4().makeRotationZ(PRINT_ORIENT_Z).multiply(new THREE.Matrix4().makeRotationX(PRINT_ORIENT_X))
      content.applyMatrix4(rotation)
    }

    const root = new THREE.Group()
    const scale = (options.scaleFactor ?? 100) / 100
    root.scale.setScalar(scale)

    const anchor = options.anchor ?? 'bottom'
    if (anchor !== 'center') {
      const anchoredBox = new THREE.Box3().setFromObject(content)
      if (anchor === 'bottom') root.position.y = -anchoredBox.min.y * scale
      else root.position.z = -anchoredBox.min.z * scale
    }
    root.add(content)
    // Unlike Box3.setFromObject (used above), STLExporter reads `object.matrixWorld` directly via a
    // plain traverse with no update pass of its own — without this, root's position/scale and
    // content's reparented position never get baked in, and the export silently reflects a stale
    // (pre-anchor, pre-scale) matrix state.
    root.updateMatrixWorld(true)

    const exporter = new STLExporter()
    // `binary: true` always resolves to a DataView over a fresh ArrayBuffer (never the `string` arm).
    const result = exporter.parse(root, { binary: true }) as DataView
    return result.buffer as ArrayBuffer
  } finally {
    for (const g of geometries) g.dispose()
  }
}

/** Trigger a browser download of a binary .stl ArrayBuffer. */
export function downloadStl(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: 'model/stl' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.stl') ? filename : `${filename}.stl`
  a.click()
  URL.revokeObjectURL(url)
}
