import * as THREE from 'three'

/**
 * One material shared by all 4 InstancedMesh pools. Per-instance emissive behavior (none /
 * solid / blink / pulse) rides on instanced buffer attributes, animated by a single global
 * clock uniform — no per-instance material overrides, all animation is GPU-driven.
 */
export function createSharedVoxelMaterial() {
  const uniforms = { uClock: { value: 0 } }

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.85,
    metalness: 0.05,
    vertexColors: true,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uClock = uniforms.uClock

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float instanceEmissiveClass;
        attribute vec3 instanceEmissiveColor;
        varying float vEmissiveClass;
        varying vec3 vEmissiveColor;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vEmissiveClass = instanceEmissiveClass;
        vEmissiveColor = instanceEmissiveColor;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uClock;
        varying float vEmissiveClass;
        varying vec3 vEmissiveColor;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float emissiveIntensity = 0.0;
        if (vEmissiveClass > 0.5 && vEmissiveClass < 1.5) {
          emissiveIntensity = 1.0;
        } else if (vEmissiveClass > 1.5 && vEmissiveClass < 2.5) {
          emissiveIntensity = step(0.5, fract(uClock * 1.5));
        } else if (vEmissiveClass > 2.5) {
          emissiveIntensity = 0.5 + 0.5 * sin(uClock * 3.0);
        }
        totalEmissiveRadiance += vEmissiveColor * emissiveIntensity;`,
      )
  }

  return { material, uniforms }
}
