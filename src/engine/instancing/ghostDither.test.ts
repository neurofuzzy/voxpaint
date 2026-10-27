import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { enableGhostDither, setGhostDither } from './ghostDither'

type FakeShader = { fragmentShader: string; uniforms: Record<string, THREE.IUniform> }

/** Simulates what WebGLRenderer does on a program-cache miss: runs onBeforeCompile once. */
function compile(mat: THREE.Material, template: string): FakeShader {
  const shader: FakeShader = { fragmentShader: template, uniforms: {} }
  const fn = mat.onBeforeCompile as unknown as (s: FakeShader, r: unknown) => void
  fn(shader, {})
  return shader
}

describe('ghostDither', () => {
  it('injects the discard into the physical and lambert templates', () => {
    for (const template of [THREE.ShaderLib.physical.fragmentShader, THREE.ShaderLib.lambert.fragmentShader]) {
      const mat = new THREE.MeshBasicMaterial()
      enableGhostDither(mat)
      setGhostDither(mat, true)
      const shader = compile(mat, template)
      expect(shader.fragmentShader).toContain('uniform float uGhostDither;')
      expect(shader.fragmentShader).toContain('if (uGhostDither > 0.5')
      expect(shader.uniforms.uGhostDither.value).toBe(1)
    }
  })

  it('toggles the uniform on the already-compiled shader (program cache-hit path)', () => {
    // Regression test: three.js skips onBeforeCompile on a program cache hit, so a toggle
    // that only works via recompile silently does nothing. The live uniform must update.
    const mat = new THREE.MeshBasicMaterial()
    enableGhostDither(mat)
    setGhostDither(mat, false)
    const shader = compile(mat, THREE.ShaderLib.physical.fragmentShader)
    expect(shader.uniforms.uGhostDither.value).toBe(0)
    // No second compile — just the toggle, exactly like a cache hit.
    setGhostDither(mat, true)
    expect(shader.uniforms.uGhostDither.value).toBe(1)
    setGhostDither(mat, false)
    expect(shader.uniforms.uGhostDither.value).toBe(0)
  })

  it('applies a pre-compile toggle at compile time', () => {
    const mat = new THREE.MeshBasicMaterial()
    enableGhostDither(mat)
    setGhostDither(mat, true)
    const shader = compile(mat, THREE.ShaderLib.physical.fragmentShader)
    expect(shader.uniforms.uGhostDither.value).toBe(1)
  })
})
