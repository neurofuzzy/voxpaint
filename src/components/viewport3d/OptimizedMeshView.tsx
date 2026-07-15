import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
import { bakeOverlayTexturesByColor } from '@/engine/texture/overlay'
import { buildTexturedGeometryByColor } from '@/engine/texture/texturedGeometry'
import { hasTextureContent } from '@/engine/texture/TextureStore'
import { buildOptimizedVoxelGroups } from '@/engine/instancing/voxelMeshBuilder'
import { triangleCount } from '@/engine/instancing/meshOptimizer'
import { buildPreviewMaterial } from '@/engine/instancing/previewMaterial'
import { useAppStore } from '@/store/useAppStore'
import { usePreviewAOMaps } from './usePreviewAOMaps'

const wireframeOverlayMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })

/**
 * Renders the whole model split into **one mesh per (materialClass, colour) pair**, each carrying
 * a `MeshPhysicalMaterial` (`buildPreviewMaterial` — the same recipe Texture and Animate mode use,
 * mirrored again by the glTF export) with PBR params from `materialParamsFor`.
 *
 * When the model has no painted texture, geometry is shell-culled and CSG-optimized (the "optimized
 * mesh" toggle merges coplanar faces on top) — solid palette colour, no vertex colours. When the
 * model *does* have painted texture content, this instead uses the same box-mapped, baked-overlay
 * geometry Texture mode uses (bypassing CSG optimization, which doesn't preserve per-face UVs), so
 * Model mode shows paint too. The `optimizedMesh` toggle and triangle-reduction stat are therefore
 * inert while textured — there's nothing to reduce without the CSG pass.
 *
 * Ambient occlusion is baked into a uv1-unwrapped atlas (non-overlapping, depth-correct hemisphere
 * sampling from the 3D voxel occupancy field) and applied via `material.aoMap`, in both branches.
 *
 * Geometry rebuilds only when the model, palette, or texture changes; the AO atlas re-bakes when
 * the model or the toggle changes. `onStats` surfaces the before/after triangle counts. When
 * wireframe is on, each group also draws a white unlit wireframe overlay.
 */
export function OptimizedMeshView() {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const texture = useAppStore((s) => s.texture)
  const wireframe = useAppStore((s) => s.wireframe)
  const optimizedMesh = useAppStore((s) => s.optimizedMesh)
  const ambientOcclusion = useAppStore((s) => s.ambientOcclusion)
  const noiseLevel = useAppStore((s) => s.noiseLevel)
  const specularNoiseLevel = useAppStore((s) => s.specularNoiseLevel)
  const aoStrength = useAppStore((s) => s.aoStrength)
  const glassRoughnessLevel = useAppStore((s) => s.glassRoughnessLevel)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)

  const setMeshTriangles = useAppStore((s) => s.setMeshTriangles)

  const textured = hasTextureContent(texture)

  const built = useMemo(() => {
    if (textured) {
      const groups = buildTexturedGeometryByColor(model, palette, gridExtent)
      const triangles = groups.reduce((sum, g) => sum + triangleCount(g.geometry), 0)
      return { groups, rawTriangles: triangles, optimizedTriangles: triangles }
    }
    return buildOptimizedVoxelGroups(model, palette, optimizedMesh)
  }, [model, palette, optimizedMesh, textured, gridExtent])

  const geometries = useMemo(() => built.groups.map((g) => g.geometry), [built])

  const { aoTexture, metalnessTexture, roughnessTexture, metalBaseColorTexture } = usePreviewAOMaps(
    model,
    geometries,
    !textured,
    { ambientOcclusion, noiseLevel, specularNoiseLevel, aoStrength },
  )

  // Painted texture bakes to an overlay map (color × blend), one per distinct colour, reused by
  // the plain-untextured branch too (where it's simply empty — buildPreviewMaterial then falls
  // back to solid colour).
  const blend = useMemo(() => (textured ? buildBlendAtlas(texture, gridExtent) : null), [textured, texture, gridExtent])
  const overlayByColor = useMemo(
    () => (blend ? bakeOverlayTexturesByColor(built.groups.map((g) => g.colorKey), blend) : null),
    [built.groups, blend],
  )
  useEffect(() => () => { for (const tex of overlayByColor?.values() ?? []) tex.dispose() }, [overlayByColor])

  // One MeshPhysicalMaterial per colour group. PBR params per class, plus the baked overlay map
  // when textured. Wireframe-overlay z-fighting avoidance (polygonOffset) applies to both branches.
  const materials = useMemo(() => {
    return built.groups.map(({ materialClass, colorKey }) => {
      const m = buildPreviewMaterial(materialClass, colorKey, {
        overlayMap: overlayByColor?.get(colorKey) ?? null,
        glassRoughnessLevel,
      })
      m.polygonOffset = true
      m.polygonOffsetFactor = 1
      m.polygonOffsetUnits = 1
      return m
    })
  }, [built.groups, overlayByColor, glassRoughnessLevel])

  // Bind (or clear) the AO, metalness, roughness, and metal base-colour maps on every material
  // (reads uv1/uv). A textured (overlay-mapped) metal group keeps its baked overlay as `.map` —
  // the specular-noise base-colour texture only applies to solid (untextured) metal, matching
  // buildPreviewMaterial's own overlay-takes-priority rule at creation time.
  useEffect(() => {
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i]
      const group = built.groups[i]
      const isMetal = group.materialClass === 'metal'
      const hasOverlay = !!overlayByColor?.get(group.colorKey)
      m.aoMap = aoTexture ?? null
      m.metalnessMap = isMetal ? metalnessTexture : null
      m.roughnessMap = isMetal ? roughnessTexture : null
      if (isMetal && !hasOverlay && metalBaseColorTexture) m.map = metalBaseColorTexture
      m.needsUpdate = true
    }
  }, [materials, built.groups, aoTexture, metalnessTexture, roughnessTexture, metalBaseColorTexture, overlayByColor])

  useEffect(() => {
    setMeshTriangles({ optimized: built.optimizedTriangles, raw: built.rawTriangles })
  }, [built, setMeshTriangles])

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
