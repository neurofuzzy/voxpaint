import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { bakeAOToAtlas } from '@/engine/ao/bakeAO'
import { unwrapGeometries } from '@/engine/ao/uvUnwrap'
import { buildOptimizedVoxelGroups } from '@/engine/instancing/voxelMeshBuilder'
import { materialParamsFor } from '@/engine/palette/palette'
import { useAppStore } from '@/store/useAppStore'

export type OptimizedMeshStats = { rawTriangles: number; optimizedTriangles: number }

const wireframeOverlayMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })

/**
 * Renders the whole model as shell-culled, CSG-optimized geometry — the 3D preview's "optimized
 * mesh" mode — split into **one mesh per (materialClass, colour) pair**. Each colour group is
 * CSG-unioned independently via ThreeBSP; the boolean union removes interior faces between same-
 * colour adjacent voxels and never bridges across disconnected voxel groups. Different colours
 * and material classes are kept in separate meshes.
 *
 * Each mesh carries a `MeshPhysicalMaterial` with a solid `color` from its palette slot (no
 * per-vertex colours), plus PBR params from `materialParamsFor`. The emissive class sets
 * `material.emissive` + `emissiveIntensity` directly instead of a shader patch.
 *
 * Ambient occlusion is baked into a uv1-unwrapped atlas (non-overlapping, depth-correct hemisphere
 * sampling from the 3D voxel occupancy field) and applied via `material.aoMap`.
 *
 * Geometry rebuilds only when the model or palette changes; the AO atlas re-bakes when the model
 * or the toggle changes. `onStats` surfaces the before/after triangle counts. When wireframe is
 * on, each group also draws a white unlit wireframe overlay.
 */
export function OptimizedMeshView({ onStats }: { onStats?: (stats: OptimizedMeshStats) => void }) {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const wireframe = useAppStore((s) => s.wireframe)
  const ambientOcclusion = useAppStore((s) => s.ambientOcclusion)

  const built = useMemo(() => {
    return buildOptimizedVoxelGroups(model, palette)
  }, [model, palette])

  const geometries = useMemo(() => built.groups.map((g) => g.geometry), [built])

  const aoTexture = useMemo(() => {
    if (!ambientOcclusion) return null

    const result = unwrapGeometries(geometries)
    const atlas = result.atlas

    // Apply uv1 to each geometry
    for (let i = 0; i < geometries.length; i++) {
      geometries[i].setAttribute('uv1', new THREE.Float32BufferAttribute(result.uv1Arrays[i], 2))
    }

    const ao = bakeAOToAtlas(model, atlas)
    const tex = new THREE.DataTexture(ao.data, ao.width, ao.height, THREE.RGBAFormat)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.flipY = false
    tex.colorSpace = THREE.NoColorSpace
    tex.channel = 1
    tex.needsUpdate = true

    return tex
  }, [model, geometries, ambientOcclusion])
  useEffect(() => () => aoTexture?.dispose(), [aoTexture])

  // One MeshPhysicalMaterial per colour group. Solid colour (no vertexColors), PBR params per class.
  const materials = useMemo(() => {
    return built.groups.map(({ materialClass, colorKey }) => {
      const params = materialParamsFor(materialClass)
      const color = new THREE.Color(colorKey)
      const m = new THREE.MeshPhysicalMaterial({
        color,
        metalness: params.metalness,
        roughness: params.roughness,
        transmission: params.transmission,
        side: THREE.DoubleSide,
      })
      if (params.transmission > 0) {
        m.ior = 1.5
        m.thickness = 0.5
      }
      if (params.emissiveIntensity > 0) {
        m.emissive = color
        m.emissiveIntensity = params.emissiveIntensity
      }
      m.polygonOffset = true
      m.polygonOffsetFactor = 1
      m.polygonOffsetUnits = 1
      return m
    })
  }, [built])

  // Bind (or clear) the AO map on every material via aoMap (reads uv1).
  useEffect(() => {
    for (const m of materials) {
      m.aoMap = aoTexture
      m.needsUpdate = true
    }
  }, [materials, aoTexture])

  useEffect(() => {
    onStats?.({ rawTriangles: built.rawTriangles, optimizedTriangles: built.optimizedTriangles })
  }, [built, onStats])

  useEffect(
    () => () => {
      for (const g of built.groups) g.geometry.dispose()
    },
    [built],
  )
  useEffect(
    () => () => {
      for (const m of materials) m.dispose()
    },
    [materials],
  )

  return (
    <>
      {built.groups.map((g, i) => (
        <mesh key={i} geometry={g.geometry}>
          <primitive object={materials[i]} attach="material" />
        </mesh>
      ))}
      {wireframe &&
        built.groups.map((g, i) => (
          <mesh key={`wf-${i}`} geometry={g.geometry}>
            <primitive object={wireframeOverlayMaterial} attach="material" />
          </mesh>
        ))}
    </>
  )
}
