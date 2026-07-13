import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { bakeAOAtlas } from '@/engine/ao/bakeAO'
import { buildOptimizedVoxelGroups } from '@/engine/instancing/voxelMeshBuilder'
import { materialParamsFor } from '@/engine/palette/palette'
import { atlasUVForVertex } from '@/engine/texture/boxMapping'
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
 * Baked ambient occlusion (analytical voxel solver, `engine/ao`) is applied — when the
 * `ambientOcclusion` toggle is on — as a grayscale atlas texture bound to each material's `map`.
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
    const { groups, rawTriangles, optimizedTriangles } = buildOptimizedVoxelGroups(model, palette)
    // Add box-map atlas UVs so the AO map samples the right texel per fragment.
    for (const { geometry } of groups) {
      const pos = geometry.getAttribute('position') as THREE.BufferAttribute
      const nrm = geometry.getAttribute('normal') as THREE.BufferAttribute
      const uv = new Float32Array(pos.count * 2)
      for (let i = 0; i < pos.count; i++) {
        const [u, v] = atlasUVForVertex([nrm.getX(i), nrm.getY(i), nrm.getZ(i)], pos.getX(i), pos.getY(i), pos.getZ(i))
        uv[i * 2] = u
        uv[i * 2 + 1] = v
      }
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    }
    return { groups, rawTriangles, optimizedTriangles }
  }, [model, palette])

  // Baked AO atlas (grayscale, raw values — no sRGB decode), re-baked on model change. Null when off.
  const aoTexture = useMemo(() => {
    if (!ambientOcclusion) return null
    const { data, width, height } = bakeAOAtlas(model)
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.flipY = false
    tex.colorSpace = THREE.NoColorSpace
    tex.needsUpdate = true
    return tex
  }, [model, ambientOcclusion])
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

  // Bind (or clear) the AO map on every material.
  useEffect(() => {
    for (const m of materials) {
      m.map = aoTexture
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
