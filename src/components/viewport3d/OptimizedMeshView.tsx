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
 * Renders the whole model as shell-culled, coplanar-optimized geometry — the 3D preview's "optimized
 * mesh" mode — split into **at most four meshes, one per material class** (matte / emissive / metal /
 * glass); different classes are never merged. Each mesh carries per-vertex colours (many palette
 * colours share a class mesh) and a `MeshPhysicalMaterial` configured from its class via
 * `materialParamsFor` (`vertexColors` supplies the base colour). The emissive class additionally gets
 * a small shader patch so each vertex glows in its own colour. This is where the palette-based PBR look
 * renders: the default InstancedMesh view stays flat Lambert (three can't carry per-instance PBR
 * params). Metals and glass need `scene.environment` — supplied by <SceneEnvironment/> in Viewport3D.
 *
 * Baked ambient occlusion (analytical voxel solver, `engine/ao`) is applied — when the `ambientOcclusion`
 * toggle is on — as a grayscale atlas texture at the **same resolution/layout as the paint atlas**
 * (each texel = 0.25 voxel), bound as each material's `map`. Since three multiplies `color × map`, the
 * AO reads as a true multiply (`baseColour × ao`), not a flat overlay; box-map UVs (`atlasUVForVertex`)
 * line the AO up exactly with where paint lands.
 *
 * Geometry rebuilds only when the model or palette changes; the AO atlas re-bakes when the model or the
 * toggle changes. `onStats` surfaces the before/after triangle counts. When wireframe is on, each group
 * also draws a white unlit wireframe overlay.
 */
export function OptimizedMeshView({ onStats }: { onStats?: (stats: OptimizedMeshStats) => void }) {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const wireframe = useAppStore((s) => s.wireframe)
  const ambientOcclusion = useAppStore((s) => s.ambientOcclusion)

  const built = useMemo(() => {
    const groups = buildOptimizedVoxelGroups(model, palette)
    // Add box-map atlas UVs so the AO map samples the right texel per fragment (affine across merged
    // quads). Computed from each vertex's position + normal, matching the paint atlas exactly.
    for (const { geometry } of groups.groups) {
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
    return groups
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
    tex.colorSpace = THREE.NoColorSpace // AO is a linear multiplier, not a colour
    tex.needsUpdate = true
    return tex
  }, [model, ambientOcclusion])
  useEffect(() => () => aoTexture?.dispose(), [aoTexture])

  // One MeshPhysicalMaterial per material class. `vertexColors` supplies the per-voxel base colour
  // (white material colour × vColor); the class supplies metalness/roughness/transmission. Emissive
  // gets a shader patch so each vertex glows in its own colour (three's `emissive` is a single uniform).
  const materials = useMemo(() => {
    return built.groups.map(({ materialClass }) => {
      const params = materialParamsFor(materialClass)
      const m = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        vertexColors: true,
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
        m.onBeforeCompile = (shader) => {
          // three declares `varying vec4 vColor` even for RGB vertex colours, so use `.rgb`
          // (a bare `vColor` here is a vec3 += vec4 type error that fails the whole shader).
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * ${params.emissiveIntensity.toFixed(3)};`,
          )
        }
      }
      m.polygonOffset = true
      m.polygonOffsetFactor = 1
      m.polygonOffsetUnits = 1
      return m
    })
  }, [built])

  // Bind (or clear) the AO map on every material. `map` multiplies the base colour → baseColour × ao.
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
