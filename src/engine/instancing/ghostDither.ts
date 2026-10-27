import type * as THREE from 'three'

/**
 * Screen-door (ordered-dither) ghosting for model materials: drops every other pixel in a
 * checkerboard, so the rig boxes and pivots behind the model stay readable without any
 * transparency sorting artifacts (unlike opacity blending, discarded fragments write no depth
 * and blend nothing). Wires through `onBeforeCompile` on any mesh material — the
 * `#include <common>` / `#include <clipping_planes_fragment>` anchors exist in every built-in
 * fragment shader (Lambert, Physical, Basic alike), so one injection covers all model views.
 *
 * State is split in two on purpose (a lesson learned the hard way): three.js caches compiled
 * programs per material and SKIPS `onBeforeCompile` on a cache hit, so toggling via
 * `needsUpdate` alone leaves the uniform frozen at its first-compiled value. Instead, the
 * desired value lives in `pending` (read at every compile) and compiled shaders are tracked
 * in `live` so toggles mutate the uniform directly — instant, no recompile. `needsUpdate` is
 * only a fallback for materials compiled before the injection was installed.
 */
type GhostShader = { uniforms: Record<string, THREE.IUniform> }

const pending = new WeakMap<object, boolean>()
const live = new WeakMap<object, Set<GhostShader>>()

export function enableGhostDither(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGhostDither = { value: pending.get(mat) ? 1 : 0 }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uGhostDither;',
      )
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif (uGhostDither > 0.5 && mod(gl_FragCoord.x + gl_FragCoord.y, 2.0) < 1.0) discard;',
      )
    let shaders = live.get(mat)
    if (!shaders) {
      shaders = new Set()
      live.set(mat, shaders)
    }
    shaders.add(shader)
  }
  // All ghost-capable materials share one injection — keep them on one program cache entry so
  // a ghosted Lambert never collides with (or duplicates) a plain one.
  mat.customProgramCacheKey = () => 'ghost-dither-v1'
}

export function setGhostDither(mat: THREE.Material, ghost: boolean): void {
  pending.set(mat, ghost)
  const shaders = live.get(mat)
  if (!shaders) {
    // Never compiled with the injection (or not yet compiled at all) — recompile to apply it.
    mat.needsUpdate = true
    return
  }
  for (const shader of shaders) {
    shader.uniforms.uGhostDither.value = ghost ? 1 : 0
  }
}
