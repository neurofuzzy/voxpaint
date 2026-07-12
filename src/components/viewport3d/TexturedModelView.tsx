import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildBlendAtlas } from '@/engine/texture/boxMapping'
import { OVERLAY_COLOR_FRAGMENT, OVERLAY_MAP_FRAGMENT } from '@/engine/texture/overlay'
import { buildTexturedGeometry } from '@/engine/texture/texturedGeometry'
import { useAppStore } from '@/store/useAppStore'

/**
 * Texture-mode 3D preview: the whole model as one box-mapped, shell-culled mesh. Each voxel's
 * palette color is a vertex color; the atlas supplies a per-texel **blend value** which a patched
 * Lambert shader combines via **overlay** (`onBeforeCompile`) — grayscale < 0.5 darkens, > 0.5
 * lightens, 0.5 is neutral. Uses the same overlay math as the GLTF bake, so preview == export.
 * Geometry rebuilds on model change; the blend `DataTexture` re-uploads on texture change.
 */
export function TexturedModelView() {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const texture = useAppStore((s) => s.texture)

  const geometry = useMemo(() => buildTexturedGeometry(model, palette), [model, palette])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    m.polygonOffset = true
    m.polygonOffsetFactor = 1
    m.polygonOffsetUnits = 1
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', OVERLAY_MAP_FRAGMENT)
        .replace('#include <color_fragment>', OVERLAY_COLOR_FRAGMENT)
    }
    return m
  }, [])
  useEffect(() => () => material.dispose(), [material])

  const blendTexture = useMemo(() => {
    const { data, width, height } = buildBlendAtlas(texture)
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.flipY = false
    tex.colorSpace = THREE.NoColorSpace // raw blend values — no sRGB decode on sample
    tex.needsUpdate = true
    return tex
  }, [texture])
  useEffect(() => () => blendTexture.dispose(), [blendTexture])

  useEffect(() => {
    material.map = blendTexture
    material.needsUpdate = true
  }, [material, blendTexture])

  return (
    <mesh geometry={geometry}>
      <primitive object={material} attach="material" />
    </mesh>
  )
}
