import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
import { bakeOverlayTexturesByColor } from '@/engine/texture/overlay'
import { buildTexturedGeometryByColor } from '@/engine/texture/texturedGeometry'
import { buildPreviewMaterial, tickEmissiveAnimation } from '@/engine/instancing/previewMaterial'
import { buildEmissiveAnimIndex } from '@/engine/palette/emissiveAnimation'
import { useAppStore } from '@/store/useAppStore'
import { usePreviewAOMaps } from './usePreviewAOMaps'

/**
 * Texture-mode 3D preview: box-mapped, shell-culled geometry split per (color, material class),
 * each rendered with the same `MeshPhysicalMaterial` recipe as Model mode (`buildPreviewMaterial`)
 * so metal/glass/emissive read correctly here too — plus the painted overlay baked into `map`, via
 * the same CPU bake the GLTF export uses (`bakeOverlayTexture`), so preview == export. Also gets
 * the same AO/specular-noise bake as Model mode (`usePreviewAOMaps`), so switching modes on a
 * painted model doesn't lose or change the shading.
 * Geometry rebuilds on model change; the baked overlay textures re-bake on texture change.
 */
export function TexturedModelView() {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const texture = useAppStore((s) => s.texture)
  const glassRoughnessLevel = useAppStore((s) => s.glassRoughnessLevel)
  const ambientOcclusion = useAppStore((s) => s.ambientOcclusion)
  const noiseLevel = useAppStore((s) => s.noiseLevel)
  const specularNoiseLevel = useAppStore((s) => s.specularNoiseLevel)
  const aoStrength = useAppStore((s) => s.aoStrength)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const noiseSeed = useAppStore((s) => s.meta.noiseSeed)

  const groups = useMemo(() => buildTexturedGeometryByColor(model, palette, gridExtent), [model, palette, gridExtent])
  useEffect(() => () => { for (const g of groups) g.geometry.dispose() }, [groups])

  // Emissive materials skip AO/noise baking entirely (see OptimizedMeshView) — excluded from the
  // unwrap atlas; they still occlude everything else, since occlusion sampling reads the 3D model.
  const geometries = useMemo(
    () => groups.filter((g) => g.materialClass !== 'emissive').map((g) => g.geometry),
    [groups],
  )
  const { aoTexture, metalnessTexture, roughnessTexture } = usePreviewAOMaps(
    model,
    geometries,
    false,
    { ambientOcclusion, noiseLevel, specularNoiseLevel, aoStrength, noiseSeed },
  )

  const blend = useMemo(() => buildBlendAtlas(texture, gridExtent), [texture, gridExtent])

  const overlayByColor = useMemo(
    () => bakeOverlayTexturesByColor(groups.map((g) => g.colorKey), blend),
    [groups, blend],
  )
  useEffect(() => () => { for (const tex of overlayByColor.values()) tex.dispose() }, [overlayByColor])

  const emissiveAnimIndex = useMemo(() => buildEmissiveAnimIndex(palette), [palette])

  const materials = useMemo(
    () => groups.map((g) => buildPreviewMaterial(g.materialClass, g.colorKey, {
      overlayMap: overlayByColor.get(g.colorKey) ?? null,
      glassRoughnessLevel,
      emissiveAnimMode: emissiveAnimIndex.get(g.colorKey),
    })),
    [groups, overlayByColor, glassRoughnessLevel, emissiveAnimIndex],
  )
  useEffect(() => () => { for (const m of materials) m.dispose() }, [materials])

  useFrame(() => {
    const elapsed = performance.now() / 1000
    for (const m of materials) tickEmissiveAnimation(m, elapsed)
  })

  // Bind AO/specular-noise maps after creation, mirroring Model mode: the baked overlay set at
  // creation stays as `.map` (metal's specular-noise base-colour texture only applies when there's
  // no overlay to begin with, which in Texture mode there always is for non-glass groups).
  useEffect(() => {
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i]
      const isMetal = groups[i].materialClass === 'metal'
      m.aoMap = groups[i].materialClass !== 'emissive' ? (aoTexture ?? null) : null
      m.metalnessMap = isMetal ? metalnessTexture : null
      m.roughnessMap = isMetal ? roughnessTexture : null
      m.needsUpdate = true
    }
  }, [materials, groups, aoTexture, metalnessTexture, roughnessTexture])

  return (
    <>
      {groups.map((g, i) => (
        <mesh key={i} geometry={g.geometry}>
          <primitive object={materials[i]} attach="material" />
        </mesh>
      ))}
    </>
  )
}
