import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { bakeAOToAtlas, makeSpecularNoiseTexture } from '@/engine/ao/bakeAO'
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
  const optimizedMesh = useAppStore((s) => s.optimizedMesh)
  const ambientOcclusion = useAppStore((s) => s.ambientOcclusion)
  const noiseLevel = useAppStore((s) => s.noiseLevel)
  const specularNoiseLevel = useAppStore((s) => s.specularNoiseLevel)
  const aoStrength = useAppStore((s) => s.aoStrength)
  const glassRoughnessLevel = useAppStore((s) => s.glassRoughnessLevel)

  const built = useMemo(() => {
    return buildOptimizedVoxelGroups(model, palette, optimizedMesh)
  }, [model, palette, optimizedMesh])

  const geometries = useMemo(() => built.groups.map((g) => g.geometry), [built])

  // Shared UV-unwrap — computed once, reused by AO and specular-noise textures.
  const unwrap = useMemo(() => {
    const result = unwrapGeometries(geometries)
    for (let i = 0; i < geometries.length; i++) {
      const uv1 = new THREE.Float32BufferAttribute(result.uv1Arrays[i], 2)
      geometries[i].setAttribute('uv1', uv1)
      geometries[i].setAttribute('uv', uv1)
    }
    return result
  }, [geometries])

  const aoTexture = useMemo(() => {
    if (!ambientOcclusion && noiseLevel <= 0) return null
    const effectiveAo = ambientOcclusion ? aoStrength : 1
    const baked = bakeAOToAtlas(model, unwrap.atlas, noiseLevel, effectiveAo)
    const tex = new THREE.DataTexture(baked.data, baked.width, baked.height, THREE.RGBAFormat)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.flipY = false
    tex.colorSpace = THREE.NoColorSpace
    tex.channel = 1
    tex.needsUpdate = true
    return tex
  }, [model, unwrap, ambientOcclusion, noiseLevel, aoStrength])
  useEffect(() => () => aoTexture?.dispose(), [aoTexture])

  const specularTexture = useMemo(() => {
    if (specularNoiseLevel <= 0) return null
    const spec = makeSpecularNoiseTexture(unwrap.atlas, specularNoiseLevel)
    const mkt = (d: Uint8ClampedArray, w: number, h: number, srgb: boolean) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      const img = ctx.createImageData(w, h)
      img.data.set(d)
      ctx.putImageData(img, 0, 0)
      const t = new THREE.CanvasTexture(canvas)
      t.magFilter = THREE.NearestFilter
      t.minFilter = THREE.NearestFilter
      t.generateMipmaps = false
      t.flipY = false
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      t.needsUpdate = true
      return t
    }
    return {
      metalness: mkt(spec.metalness.data, spec.metalness.width, spec.metalness.height, false),
      roughness: mkt(spec.roughness.data, spec.roughness.width, spec.roughness.height, false),
      baseColor: mkt(spec.baseColor.data, spec.baseColor.width, spec.baseColor.height, true),
    }
  }, [unwrap, specularNoiseLevel])
  useEffect(() => {
    return () => {
      specularTexture?.metalness.dispose()
      specularTexture?.roughness.dispose()
      specularTexture?.baseColor.dispose()
    }
  }, [specularTexture])

  // One MeshPhysicalMaterial per colour group. Solid colour (no vertexColors), PBR params per class.
  const materials = useMemo(() => {
    return built.groups.map(({ materialClass, colorKey }) => {
      const params = materialParamsFor(materialClass)
      const color = new THREE.Color(colorKey)
      const isGlass = materialClass === 'glass'
      const m = new THREE.MeshPhysicalMaterial({
        color,
        metalness: params.metalness,
        roughness: isGlass ? glassRoughnessLevel : params.roughness,
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
  }, [built, glassRoughnessLevel])

  // Bind (or clear) the AO, metalness, roughness, and base-colour maps on every material (reads uv1/uv).
  useEffect(() => {
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i]
      const isMetal = built.groups[i].materialClass === 'metal'
      m.aoMap = aoTexture ?? null
      m.metalnessMap = isMetal ? (specularTexture?.metalness ?? null) : null
      m.roughnessMap = isMetal ? (specularTexture?.roughness ?? null) : null
      m.map = isMetal ? (specularTexture?.baseColor ?? null) : null
      m.needsUpdate = true
    }
  }, [materials, built.groups, aoTexture, specularTexture])

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
