import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { VoxelModel } from '@/engine/grid/types'
import { bakeAOToAtlas, makeSpecularNoiseTexture } from '@/engine/ao/bakeAO'
import { unwrapGeometries } from '@/engine/ao/uvUnwrap'

export type PreviewAOMaps = {
  aoTexture: THREE.DataTexture | null
  metalnessTexture: THREE.Texture | null
  roughnessTexture: THREE.Texture | null
  metalBaseColorTexture: THREE.Texture | null
}

function canvasTexture(data: Uint8ClampedArray, width: number, height: number, srgb: boolean, channel: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, height)
  img.data.set(data)
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(canvas)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.flipY = false
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.channel = channel
  t.needsUpdate = true
  return t
}

/**
 * Shared AO + specular-noise texture baking for the live 3D preview, so Model and Texture mode
 * apply the exact same View Settings-driven maps. Unwraps `geometries` into a `uv1` atlas (mutates
 * each geometry, adding the `uv1` attribute) — reused by both bakes. Every returned texture is
 * pinned to the UV channel that actually holds the unwrap (`texture.channel`, same mechanism the
 * built-in `aoMap` uses) rather than relying on the default channel-0/`uv` sampling, since `uv`
 * doesn't always hold the unwrap: pass `shareUv0: true` only when the geometries have no other use
 * for `uv` (untextured groups), which also copies the unwrap onto `uv` so channel-0 consumers still
 * work; textured groups need `uv` for their box-map/overlay texture, so pass `shareUv0: false` and
 * every map here samples `uv1` (channel 1) instead.
 */
export function usePreviewAOMaps(
  model: VoxelModel,
  geometries: THREE.BufferGeometry[],
  shareUv0: boolean,
  options: { ambientOcclusion: boolean; noiseLevel: number; specularNoiseLevel: number; aoStrength: number },
): PreviewAOMaps {
  const { ambientOcclusion, noiseLevel, specularNoiseLevel, aoStrength } = options

  const unwrap = useMemo(() => {
    const result = unwrapGeometries(geometries)
    for (let i = 0; i < geometries.length; i++) {
      const uv1 = new THREE.Float32BufferAttribute(result.uv1Arrays[i], 2)
      geometries[i].setAttribute('uv1', uv1)
      if (shareUv0) geometries[i].setAttribute('uv', uv1)
    }
    return result
  }, [geometries, shareUv0])

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
    const channel = shareUv0 ? 0 : 1
    return {
      metalness: canvasTexture(spec.metalness.data, spec.metalness.width, spec.metalness.height, false, channel),
      roughness: canvasTexture(spec.roughness.data, spec.roughness.width, spec.roughness.height, false, channel),
      baseColor: canvasTexture(spec.baseColor.data, spec.baseColor.width, spec.baseColor.height, true, channel),
    }
  }, [unwrap, specularNoiseLevel, shareUv0])
  useEffect(() => {
    return () => {
      specularTexture?.metalness.dispose()
      specularTexture?.roughness.dispose()
      specularTexture?.baseColor.dispose()
    }
  }, [specularTexture])

  return {
    aoTexture,
    metalnessTexture: specularTexture?.metalness ?? null,
    roughnessTexture: specularTexture?.roughness ?? null,
    metalBaseColorTexture: specularTexture?.baseColor ?? null,
  }
}
