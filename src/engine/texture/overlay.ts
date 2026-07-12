/**
 * Photoshop-style "overlay" blend, shared by the live preview (GLSL) and the GLTF export bake (JS)
 * so what you paint matches what exports. Overlay darkens where blend < 0.5, lightens where > 0.5,
 * and is a no-op at exactly 0.5 — which is why the texture atlas stores the grayscale index as a
 * **blend value** (`index/4`, so the middle gray index 2 = 0.5 = neutral), not a color.
 *
 * Both are computed in sRGB (gamma) space with the pivot at 0.5, so the neutral point matches the
 * middle swatch perceptually. The GLSL path reconstructs the voxel's sRGB color from the (linear)
 * vertex color via `vpLin2Srgb`; the JS bake starts from the already-sRGB palette hex — so the two
 * produce the same final surface color.
 */

/** Overlay one sRGB channel (`base`) with a `blend` scalar, all in [0,1]. */
export function overlayChannel(base: number, blend: number): number {
  return base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend)
}

/**
 * Replacement for three's `<map_fragment>`: overlay the (grayscale) blend texel onto the voxel's
 * base color, converting through sRGB so the pivot matches the export bake. All math is inlined (no
 * helper functions) so it needs no separate injection point. Reads the voxel color straight from
 * `vColor` (the vertex-color varying, `.rgb` works whether it's vec3 or vec4) rather than
 * `diffuseColor`, because three runs `<map_fragment>` *before* `<color_fragment>` — so the default
 * vertex-color multiply is also neutralized (see `OVERLAY_COLOR_FRAGMENT`) to avoid applying the
 * color twice. `vpBase` = linear→sRGB(vColor); `vpRes` = overlay(vpBase, blend); result = sRGB→linear.
 */
export const OVERLAY_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  float vpBlend = texture2D( map, vMapUv ).r;
  vec3 vpC = max( vColor.rgb, vec3( 0.0 ) );
  vec3 vpBase = mix( 1.055 * pow( vpC, vec3( 1.0 / 2.4 ) ) - 0.055, vpC * 12.92, step( vpC, vec3( 0.0031308 ) ) );
  vec3 vpRes = mix( 2.0 * vpBase * vpBlend, 1.0 - 2.0 * ( 1.0 - vpBase ) * ( 1.0 - vpBlend ), step( vec3( 0.5 ), vpBase ) );
  diffuseColor.rgb = mix( pow( ( vpRes + 0.055 ) / 1.055, vec3( 2.4 ) ), vpRes / 12.92, step( vpRes, vec3( 0.04045 ) ) );
#endif
`

/** Replacement for three's `<color_fragment>`: a no-op, since `OVERLAY_MAP_FRAGMENT` already folded
 * the vertex (voxel) color into `diffuseColor` via the overlay. */
export const OVERLAY_COLOR_FRAGMENT = ''
