import * as THREE from 'three'

/**
 * Photoshop-style "overlay" blend, shared by the live preview bake and the GLTF export bake so
 * what you paint matches what exports. Overlay darkens where blend < 0.5, lightens where > 0.5,
 * and is a no-op at exactly 0.5 — which is why the texture atlas stores the grayscale index as a
 * **blend value** (`index/4`, so the middle gray index 2 = 0.5 = neutral), not a color.
 *
 * Computed in sRGB (gamma) space with the pivot at 0.5, so the neutral point matches the middle
 * swatch perceptually, starting from the already-sRGB palette hex.
 */

/** Overlay one sRGB channel (`base`) with a `blend` scalar, all in [0,1]. */
export function overlayChannel(base: number, blend: number): number {
  return base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend)
}

/**
 * Bake `overlay(color, blend)` into an sRGB RGBA texture for one color group. `blendData` is the
 * shared blend atlas (R = blend·255); `colorKey` is the group's packed sRGB color. The result is a
 * standard `baseColorTexture` (with `baseColorFactor` = white), so the live preview and any glTF
 * viewer reproduce the identical overlay with no custom shader.
 */
export function bakeOverlayTexture(blendData: Uint8ClampedArray, width: number, height: number, colorKey: number): THREE.DataTexture {
  const r = ((colorKey >> 16) & 255) / 255
  const g = ((colorKey >> 8) & 255) / 255
  const b = (colorKey & 255) / 255
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const blend = blendData[i * 4] / 255
    out[i * 4] = overlayChannel(r, blend) * 255
    out[i * 4 + 1] = overlayChannel(g, blend) * 255
    out[i * 4 + 2] = overlayChannel(b, blend) * 255
    out[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(out, width, height, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.flipY = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Bakes one overlay texture per distinct `colorKey` in `colorKeys` (deduplicated), reused by
 * every group sharing that color — the bake only depends on color + the shared blend atlas. */
export function bakeOverlayTexturesByColor(
  colorKeys: Iterable<number>,
  blend: { data: Uint8ClampedArray; width: number; height: number },
): Map<number, THREE.DataTexture> {
  const cache = new Map<number, THREE.DataTexture>()
  for (const colorKey of colorKeys) {
    if (cache.has(colorKey)) continue
    cache.set(colorKey, bakeOverlayTexture(blend.data, blend.width, blend.height, colorKey))
  }
  return cache
}
