import * as THREE from 'three'
import { materialParamsFor, type MaterialClass } from '@/engine/palette/palette'
import { emissiveAnimFactor } from '@/engine/palette/emissiveAnimation'
import type { EmissiveAnimMode } from '@/engine/palette/types'

export type PreviewMaterialOptions = {
  /** Roughness for glass materials (0–1); ignored for other classes. */
  glassRoughnessLevel: number
  /** Baked color×overlay texture (see `bakeOverlayTexture`) for the painted-texture preview.
   * Never applied to glass — a transmissive material keeps its solid tint, matching the export. */
  overlayMap?: THREE.Texture | null
  /** AO bake, sampled on uv1. */
  aoMap?: THREE.Texture | null
  /** Metal-only specular noise maps, sampled on uv (or uv1 when there's no overlayMap using it). */
  metalnessMap?: THREE.Texture | null
  roughnessMap?: THREE.Texture | null
  metalBaseColorMap?: THREE.Texture | null
  /** Emissive-only: blink/pulse this material's glow live (see `tickEmissiveAnimation`). */
  emissiveAnimMode?: EmissiveAnimMode
  /** Emissive-only: the color a blinking/pulsing material's albedo fades TOWARD at "off", instead of
   * pure black — pass `darkestBaseColor(palette)` (see `engine/palette/palette.ts`) so a dimmed light
   * reads as an ordinary unlit surface matching the model's own shadow tone. Falls back to black if
   * omitted. */
  emissiveAnimOffColor?: THREE.Color
}

type EmissiveAnimUserData = {
  emissiveAnimMode: EmissiveAnimMode
  emissiveAnimBaseIntensity: number
  /** The material's un-animated `color` (its `MeshPhysicalMaterial` base color at "on"). */
  emissiveAnimBaseColor: THREE.Color
  /** The color the albedo fades toward at "off" (see `PreviewMaterialOptions.emissiveAnimOffColor`) —
   * `emissiveIntensity` still drops to 0 regardless, so the *glow* always fully turns off; only the
   * lit surface color is pinned to this instead of black. */
  emissiveAnimOffColor: THREE.Color
}

/** Advances one material's live blink/pulse, if `buildPreviewMaterial` tagged it with an animated
 * mode. Safe to call on every material every frame — untagged (or 'none') materials no-op. */
export function tickEmissiveAnimation(material: THREE.Material, elapsedSeconds: number): void {
  const anim = (material as THREE.Material & { userData: Partial<EmissiveAnimUserData> }).userData
  if (!anim.emissiveAnimMode || anim.emissiveAnimMode === 'none') return
  const physical = material as THREE.MeshPhysicalMaterial
  const factor = emissiveAnimFactor(anim.emissiveAnimMode, elapsedSeconds)
  physical.emissiveIntensity = anim.emissiveAnimBaseIntensity! * factor
  physical.color.copy(anim.emissiveAnimOffColor!).lerp(anim.emissiveAnimBaseColor!, factor)
}

/**
 * One `MeshPhysicalMaterial` per (materialClass, colorKey) group — the single recipe shared by
 * Model, Texture, and Animate mode live previews and mirrored by the glTF export
 * (`gltfExport.ts`), so every render surface agrees on what a materialClass actually looks like.
 */
export function buildPreviewMaterial(materialClass: MaterialClass, colorKey: number, options: PreviewMaterialOptions): THREE.MeshPhysicalMaterial {
  const params = materialParamsFor(materialClass)
  const isGlass = materialClass === 'glass'
  const overlayMap = isGlass ? null : (options.overlayMap ?? null)
  const color = new THREE.Color(colorKey)

  const material = new THREE.MeshPhysicalMaterial({
    color: overlayMap ? 0xffffff : color,
    map: overlayMap,
    metalness: params.metalness,
    roughness: isGlass ? options.glassRoughnessLevel : params.roughness,
    transmission: params.transmission,
    side: THREE.DoubleSide,
  })
  if (params.transmission > 0) {
    material.ior = 1.5
    material.thickness = 0.5
  }
  if (params.emissiveIntensity > 0) {
    material.emissive = color
    material.emissiveIntensity = params.emissiveIntensity
    const animMode = options.emissiveAnimMode ?? 'none'
    if (animMode !== 'none') {
      material.userData.emissiveAnimMode = animMode
      material.userData.emissiveAnimBaseIntensity = params.emissiveIntensity
      material.userData.emissiveAnimBaseColor = material.color.clone()
      material.userData.emissiveAnimOffColor = options.emissiveAnimOffColor?.clone() ?? new THREE.Color(0x000000)
    }
  }
  if (options.aoMap) material.aoMap = options.aoMap
  if (materialClass === 'metal') {
    material.specularIntensity = 0
    if (options.metalnessMap) material.metalnessMap = options.metalnessMap
    if (options.roughnessMap) material.roughnessMap = options.roughnessMap
    if (!overlayMap && options.metalBaseColorMap) material.map = options.metalBaseColorMap
  }
  return material
}
